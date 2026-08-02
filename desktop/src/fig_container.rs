use std::{collections::HashSet, io::Write};

const NATIVE_FIG_BUILD_MAGIC: &[u8; 8] = b"OPFIGIPC";
const NATIVE_FIG_BUILD_VERSION: u32 = 1;
const FIG_KIWI_VERSION_PRESENT: u32 = 1;
const DEFAULT_FIG_KIWI_VERSION: u32 = 101;

struct ImageEntry<'a> {
    name: &'a str,
    data: &'a [u8],
}

struct FigBuildPayload<'a> {
    schema_deflated: &'a [u8],
    kiwi_data: &'a [u8],
    thumbnail_png: &'a [u8],
    meta_json: &'a str,
    images: Vec<ImageEntry<'a>>,
    fig_kiwi_version: Option<u32>,
}

struct PayloadReader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> PayloadReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn bytes(&mut self, len: usize, label: &str) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or_else(|| format!("{label} length overflow"))?;
        if end > self.data.len() {
            return Err(format!("Native .fig payload is truncated at {label}"));
        }
        let value = &self.data[self.offset..end];
        self.offset = end;
        Ok(value)
    }

    fn u32(&mut self, label: &str) -> Result<u32, String> {
        let bytes: [u8; 4] = self
            .bytes(4, label)?
            .try_into()
            .map_err(|_| format!("Native .fig payload is truncated at {label}"))?;
        Ok(u32::from_le_bytes(bytes))
    }

    fn text(&mut self, len: usize, label: &str) -> Result<&'a str, String> {
        std::str::from_utf8(self.bytes(len, label)?)
            .map_err(|_| format!("Native .fig payload contains invalid UTF-8 in {label}"))
    }

    fn finish(self) -> Result<(), String> {
        if self.offset == self.data.len() {
            Ok(())
        } else {
            Err("Native .fig payload contains trailing bytes".into())
        }
    }
}

fn validate_image_name(name: &str, seen: &mut HashSet<String>) -> Result<(), String> {
    let relative = name
        .strip_prefix("images/")
        .ok_or_else(|| "Native .fig image name must start with images/".to_string())?;
    if relative.is_empty()
        || name.contains('\\')
        || name.contains('\0')
        || relative
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(format!("Unsafe native .fig image name: {name}"));
    }
    if !seen.insert(name.to_string()) {
        return Err(format!("Duplicate native .fig image name: {name}"));
    }
    Ok(())
}

fn parse_build_payload(data: &[u8]) -> Result<FigBuildPayload<'_>, String> {
    let mut reader = PayloadReader::new(data);
    if reader.bytes(NATIVE_FIG_BUILD_MAGIC.len(), "magic")? != NATIVE_FIG_BUILD_MAGIC {
        return Err("Invalid native .fig payload magic".into());
    }
    let envelope_version = reader.u32("envelope version")?;
    if envelope_version != NATIVE_FIG_BUILD_VERSION {
        return Err(format!(
            "Unsupported native .fig payload version: {envelope_version}"
        ));
    }
    let flags = reader.u32("flags")?;
    if flags & !FIG_KIWI_VERSION_PRESENT != 0 {
        return Err(format!("Unsupported native .fig payload flags: {flags}"));
    }
    let raw_fig_kiwi_version = reader.u32("fig-kiwi version")?;
    if flags & FIG_KIWI_VERSION_PRESENT == 0 && raw_fig_kiwi_version != 0 {
        return Err("Absent fig-kiwi version must be encoded as zero".into());
    }
    let schema_len = reader.u32("schema length")? as usize;
    let kiwi_len = reader.u32("Kiwi length")? as usize;
    let thumbnail_len = reader.u32("thumbnail length")? as usize;
    let meta_len = reader.u32("metadata length")? as usize;
    let image_count = reader.u32("image count")? as usize;
    let schema_deflated = reader.bytes(schema_len, "schema")?;
    let kiwi_data = reader.bytes(kiwi_len, "Kiwi data")?;
    let thumbnail_png = reader.bytes(thumbnail_len, "thumbnail")?;
    let meta_json = reader.text(meta_len, "metadata")?;
    if schema_deflated.is_empty() || kiwi_data.is_empty() || thumbnail_png.is_empty() {
        return Err(
            "Native .fig payload requires non-empty schema, Kiwi data, and thumbnail".into(),
        );
    }
    if image_count > reader.data.len().saturating_sub(reader.offset) / 8 {
        return Err("Native .fig payload image count exceeds remaining data".into());
    }

    let mut images = Vec::with_capacity(image_count);
    let mut names = HashSet::with_capacity(image_count);
    for index in 0..image_count {
        let name_len = reader.u32(&format!("image {index} name length"))? as usize;
        let data_len = reader.u32(&format!("image {index} data length"))? as usize;
        let name = reader.text(name_len, &format!("image {index} name"))?;
        validate_image_name(name, &mut names)?;
        let data = reader.bytes(data_len, &format!("image {index} data"))?;
        images.push(ImageEntry { name, data });
    }
    reader.finish()?;

    Ok(FigBuildPayload {
        schema_deflated,
        kiwi_data,
        thumbnail_png,
        meta_json,
        images,
        fig_kiwi_version: (flags & FIG_KIWI_VERSION_PRESENT != 0).then_some(raw_fig_kiwi_version),
    })
}

fn build_fig_file_bytes(payload: &[u8]) -> Result<Vec<u8>, String> {
    let payload = parse_build_payload(payload)?;
    let mut encoder = zstd::Encoder::new(Vec::new(), 3).map_err(|e| e.to_string())?;
    encoder
        .include_contentsize(true)
        .map_err(|e| e.to_string())?;
    encoder
        .set_pledged_src_size(Some(payload.kiwi_data.len() as u64))
        .map_err(|e| e.to_string())?;
    encoder
        .write_all(payload.kiwi_data)
        .map_err(|e| e.to_string())?;
    let zstd_data = encoder.finish().map_err(|e| e.to_string())?;

    let version = payload.fig_kiwi_version.unwrap_or(DEFAULT_FIG_KIWI_VERSION);
    let schema_len = u32::try_from(payload.schema_deflated.len())
        .map_err(|_| "Native .fig schema exceeds 4 GiB".to_string())?;
    let zstd_len = u32::try_from(zstd_data.len())
        .map_err(|_| "Native .fig Kiwi data exceeds 4 GiB after compression".to_string())?;
    let fig_kiwi_len = 20usize
        .checked_add(payload.schema_deflated.len())
        .and_then(|len| len.checked_add(zstd_data.len()))
        .ok_or_else(|| "Native .fig canvas size overflow".to_string())?;
    let mut fig_kiwi = Vec::with_capacity(fig_kiwi_len);
    fig_kiwi.extend_from_slice(b"fig-kiwi");
    fig_kiwi.extend_from_slice(&version.to_le_bytes());
    fig_kiwi.extend_from_slice(&schema_len.to_le_bytes());
    fig_kiwi.extend_from_slice(payload.schema_deflated);
    fig_kiwi.extend_from_slice(&zstd_len.to_le_bytes());
    fig_kiwi.extend_from_slice(&zstd_data);

    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.start_file("canvas.fig", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(&fig_kiwi).map_err(|e| e.to_string())?;
    zip.start_file("thumbnail.png", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(payload.thumbnail_png)
        .map_err(|e| e.to_string())?;
    zip.start_file("meta.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(payload.meta_json.as_bytes())
        .map_err(|e| e.to_string())?;
    for image in payload.images {
        zip.start_file(image.name, options)
            .map_err(|e| e.to_string())?;
        zip.write_all(image.data).map_err(|e| e.to_string())?;
    }

    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

#[tauri::command]
pub async fn build_fig_file(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let payload = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.to_vec(),
        _ => return Err("build_fig_file requires a raw binary IPC payload".into()),
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || build_fig_file_bytes(&payload))
        .await
        .map_err(|error| format!("Native .fig build worker failed: {error}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn push_u32(out: &mut Vec<u8>, value: u32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn payload(version: Option<u32>, images: &[(&str, &[u8])]) -> Vec<u8> {
        let schema = [1, 2, 3];
        let kiwi = [4, 5, 6, 7];
        let thumbnail = [0x89, 0x50, 0x4e, 0x47];
        let meta = br#"{"version":1}"#;
        let mut out = NATIVE_FIG_BUILD_MAGIC.to_vec();
        push_u32(&mut out, NATIVE_FIG_BUILD_VERSION);
        push_u32(
            &mut out,
            if version.is_some() {
                FIG_KIWI_VERSION_PRESENT
            } else {
                0
            },
        );
        push_u32(&mut out, version.unwrap_or(0));
        push_u32(&mut out, schema.len() as u32);
        push_u32(&mut out, kiwi.len() as u32);
        push_u32(&mut out, thumbnail.len() as u32);
        push_u32(&mut out, meta.len() as u32);
        push_u32(&mut out, images.len() as u32);
        out.extend_from_slice(&schema);
        out.extend_from_slice(&kiwi);
        out.extend_from_slice(&thumbnail);
        out.extend_from_slice(meta);
        for (name, data) in images {
            push_u32(&mut out, name.len() as u32);
            push_u32(&mut out, data.len() as u32);
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(data);
        }
        out
    }

    #[test]
    fn parses_and_builds_raw_payload_with_custom_version_and_images() {
        let payload = payload(Some(77), &[("images/a", &[8, 9]), ("images/b", &[10])]);
        let parsed = parse_build_payload(&payload).expect("payload parses");
        assert_eq!(parsed.fig_kiwi_version, Some(77));
        assert_eq!(parsed.kiwi_data, [4, 5, 6, 7]);
        assert_eq!(parsed.images.len(), 2);

        let output = build_fig_file_bytes(&payload).expect("archive builds");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(output)).expect("valid zip");
        let mut canvas = Vec::new();
        archive
            .by_name("canvas.fig")
            .expect("canvas entry")
            .read_to_end(&mut canvas)
            .expect("canvas bytes");
        assert_eq!(&canvas[..8], b"fig-kiwi");
        assert_eq!(u32::from_le_bytes(canvas[8..12].try_into().unwrap()), 77);
        let schema_len = u32::from_le_bytes(canvas[12..16].try_into().unwrap()) as usize;
        let compressed_len_offset = 16 + schema_len;
        let compressed_len = u32::from_le_bytes(
            canvas[compressed_len_offset..compressed_len_offset + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let compressed = &canvas[compressed_len_offset + 4..][..compressed_len];
        assert_eq!(zstd::decode_all(compressed).unwrap(), [4, 5, 6, 7]);
        assert_eq!(archive.by_name("images/a").unwrap().size(), 2);
        assert_eq!(archive.by_name("images/b").unwrap().size(), 1);
    }

    #[test]
    fn defaults_version_and_rejects_malformed_envelopes() {
        let valid = payload(None, &[]);
        let output = build_fig_file_bytes(&valid).expect("archive builds");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(output)).expect("valid zip");
        let mut canvas = Vec::new();
        archive
            .by_name("canvas.fig")
            .unwrap()
            .read_to_end(&mut canvas)
            .unwrap();
        assert_eq!(
            u32::from_le_bytes(canvas[8..12].try_into().unwrap()),
            DEFAULT_FIG_KIWI_VERSION
        );

        let mut bad_magic = valid.clone();
        bad_magic[0] = b'X';
        assert!(parse_build_payload(&bad_magic).is_err());
        let mut bad_version = valid.clone();
        bad_version[8..12].copy_from_slice(&2u32.to_le_bytes());
        assert!(parse_build_payload(&bad_version).is_err());
        let mut bad_flags = valid.clone();
        bad_flags[12..16].copy_from_slice(&2u32.to_le_bytes());
        assert!(parse_build_payload(&bad_flags).is_err());
        assert!(parse_build_payload(&valid[..valid.len() - 1]).is_err());
        let mut trailing = valid.clone();
        trailing.push(0);
        assert!(parse_build_payload(&trailing).is_err());
    }

    #[test]
    fn rejects_unsafe_and_duplicate_image_names() {
        for name in ["asset", "images/../asset", "images/a\\b", "images/"] {
            assert!(parse_build_payload(&payload(None, &[(name, &[1])])).is_err());
        }
        assert!(
            parse_build_payload(&payload(None, &[("images/a", &[1]), ("images/a", &[2])])).is_err()
        );
        let mut invalid_utf8 = payload(None, &[("images/a", &[1])]);
        let name_offset = invalid_utf8
            .windows("images/a".len())
            .position(|window| window == b"images/a")
            .unwrap();
        invalid_utf8[name_offset] = 0xff;
        assert!(parse_build_payload(&invalid_utf8).is_err());
    }
}
