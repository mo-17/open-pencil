/** The platform widget owns its WebView lifetime; the HTML owns PSV and image resources. */
export function buildFlutterVRTourWidget(): string {
  return `import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

class OpenPencilVRTourWebView extends StatefulWidget {
  const OpenPencilVRTourWebView({
    super.key,
    required this.assetPath,
    this.locale = 'en',
  });

  final String assetPath;
  final String locale;

  @override
  State<OpenPencilVRTourWebView> createState() => _OpenPencilVRTourWebViewState();
}

class _OpenPencilVRTourWebViewState extends State<OpenPencilVRTourWebView>
    with WidgetsBindingObserver {
  WebViewController? _controller;
  int _generation = 0;
  bool _active = true;
  bool _loading = true;
  bool _failed = false;
  String? _documentUrl;

  bool get _supported => !kIsWeb && const <TargetPlatform>{
    TargetPlatform.android, TargetPlatform.iOS, TargetPlatform.macOS,
  }.contains(defaultTargetPlatform);

  bool _current(int generation) => mounted && _active && generation == _generation;

  bool _localDocument(String value) {
    final uri = Uri.tryParse(value);
    return uri != null && uri.scheme == 'file' && uri.host.isEmpty &&
        uri.userInfo.isEmpty && !uri.hasQuery && !uri.hasFragment &&
        uri.path.endsWith('/' + widget.assetPath) &&
        (_documentUrl == null || value == _documentUrl);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_supported || !_active) return;
    final generation = ++_generation;
    if (!RegExp(r'^assets/vr-tour/[A-Za-z0-9_-]+[.]html$').hasMatch(widget.assetPath)) {
      setState(() { _failed = true; _loading = false; });
      return;
    }
    setState(() { _failed = false; _loading = true; });
    try {
      final controller = WebViewController();
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      if (!_current(generation)) return;
      await controller.setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (request) {
          if (!_current(generation) || !request.isMainFrame || !_localDocument(request.url)) {
            return NavigationDecision.prevent;
          }
          _documentUrl ??= request.url;
          return NavigationDecision.navigate;
        },
        onPageFinished: (url) {
          if (_current(generation) && _localDocument(url)) {
            _documentUrl ??= url;
            setState(() { _loading = false; });
          }
        },
        onWebResourceError: (error) {
          if (_current(generation) && error.isForMainFrame != false) {
            _fail(generation);
          }
        },
      ));
      if (!_current(generation)) return;
      setState(() { _controller = controller; });
      await controller.loadFlutterAsset(widget.assetPath);
    } catch (_) {
      _fail(generation);
    }
  }

  void _fail(int generation) {
    if (!_current(generation)) return;
    _release();
    setState(() { _failed = true; _loading = false; });
  }

  Future<void> _disposeDocument(WebViewController controller) async {
    try {
      await controller.runJavaScript('globalThis.__openpencilDisposeVRTour?.()');
    } catch (_) {
      // The platform view may already have detached; pagehide also owns cleanup.
    }
  }

  void _release() {
    _generation += 1;
    final controller = _controller;
    _controller = null;
    _documentUrl = null;
    if (controller != null) unawaited(_disposeDocument(controller));
  }

  @override
  void didUpdateWidget(covariant OpenPencilVRTourWebView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.assetPath != widget.assetPath) {
      _release();
      unawaited(_load());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      if (!_active) return;
      _active = false;
      _release();
      if (mounted) setState(() {});
    } else if (state == AppLifecycleState.resumed && !_active) {
      _active = true;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _active = false;
    _release();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chinese = widget.locale == 'zh-CN';
    if (!_supported) return Center(child: Text(chinese
        ? '此 VR 看房需要 Android、iOS 或 macOS 系统 WebView。'
        : 'This VR tour requires an Android, iOS or macOS system WebView.',
        textAlign: TextAlign.center));
    if (!_active) return Center(child: Text(chinese ? '全景已暂停' : 'Panorama paused'));
    if (_failed) return Center(child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(chinese ? '无法加载本地全景页面。请先完成 README 中的 VR 准备步骤。'
            : 'Local panorama page could not load. Complete the VR preparation steps in README.',
            textAlign: TextAlign.center),
        TextButton(onPressed: () { _release(); unawaited(_load()); },
            child: Text(chinese ? '重试' : 'Retry')),
      ],
    ));
    final controller = _controller;
    return Stack(fit: StackFit.expand, children: [
      if (controller != null)
        WebViewWidget(
          key: ValueKey(_generation),
          controller: controller,
          gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{
            Factory<EagerGestureRecognizer>(() => EagerGestureRecognizer()),
          },
        ),
      if (_loading) const Center(child: CircularProgressIndicator()),
    ]);
  }
}
`
}
