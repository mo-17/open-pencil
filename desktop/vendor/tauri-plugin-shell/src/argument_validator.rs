// Copyright OpenPencil contributors
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use regex::{Regex, RegexBuilder};

// Host-authored bounded Unicode JSON validators exceed regex's default 10 MiB
// NFA budget. This is a compilation budget, not an argument-length allowance.
const COMPILED_SIZE_LIMIT: usize = 32 * 1024 * 1024;

pub(crate) fn compile(pattern: &str) -> Result<Regex, regex::Error> {
    RegexBuilder::new(pattern)
        .size_limit(COMPILED_SIZE_LIMIT)
        .build()
}
