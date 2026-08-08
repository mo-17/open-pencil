import type { IRDocStateDecl } from '#compiler/ir/types'
import type { CompilerOptions } from '#compiler/types'

import { safeNativeStateDefault } from '../native-shared'
import { dartLiteral } from './expression'
import { dartPackageName, dartString, yamlString } from './names'

export interface FlutterPageEntry {
  className: string
  fileName: string
  importAlias: string
  route: string
}

export function buildFlutterPubspec(
  options: CompilerOptions,
  assetPaths: readonly string[]
): string {
  const packageName = dartPackageName(options.packageName)
  const productName = options.productName?.trim() || options.packageName.trim() || 'OpenPencil App'
  const assets = assetPaths.length
    ? `\n  assets:\n${assetPaths.map((path) => `    - ${yamlString(path)}`).join('\n')}`
    : ''
  return `name: ${packageName}
description: ${yamlString(`Source-only Flutter export for ${productName}`)}
publish_to: "none"
version: 0.0.0+1

environment:
  sdk: ">=3.3.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter

dev_dependencies:
  flutter_test:
    sdk: flutter

flutter:
  uses-material-design: true${assets}
`
}

export function buildFlutterMain(
  options: CompilerOptions,
  pages: readonly FlutterPageEntry[],
  router: boolean
): string {
  const imports = pages
    .map((page) => `import 'pages/${page.fileName}' as ${page.importAlias};`)
    .join('\n')
  const productName = options.productName?.trim() || options.packageName.trim() || 'OpenPencil App'
  if (pages.length === 0) {
    return `import 'package:flutter/material.dart';

void main() => runApp(const OpenPencilApp());

class OpenPencilApp extends StatelessWidget {
  const OpenPencilApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(home: Scaffold(body: SizedBox.shrink()));
  }
}
`
  }
  const first = pages[0]
  const landing = pages.find(
    (page) => !page.route.split('/').some((segment) => segment.startsWith(':'))
  )
  if (!router) {
    return `import 'package:flutter/material.dart';

${imports}

void main() => runApp(const OpenPencilApp());

class OpenPencilApp extends StatelessWidget {
  const OpenPencilApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: ${dartString(productName)},
      home: const ${first.importAlias}.${first.className}(),
    );
  }
}
`
  }
  const routeArms = pages
    .map(
      (
        page
      ) => `    final ${page.importAlias}Params = _matchOpenPencilRoute(${dartString(page.route)}, path);
    if (${page.importAlias}Params != null) {
      return MaterialPageRoute<void>(
        settings: settings,
        builder: (_) => ${page.importAlias}.${page.className}(
          routeParams: ${page.importAlias}Params,
          queryParams: uri.queryParameters,
        ),
      );
    }`
    )
    .join('\n')
  return `import 'package:flutter/material.dart';

${imports}

void main() => runApp(const OpenPencilApp());

class OpenPencilApp extends StatelessWidget {
  const OpenPencilApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: ${dartString(productName)},
      home: ${
        landing
          ? `const ${landing.importAlias}.${landing.className}()`
          : "const Scaffold(body: SafeArea(child: Center(child: Text('Open a concrete application route'))))"
      },
      onGenerateRoute: _openPencilRouteFactory,
    );
  }
}

Route<void> _openPencilRouteFactory(RouteSettings settings) {
  final uri = Uri.tryParse(settings.name ?? ${dartString(first.route)}) ?? Uri(path: ${dartString(first.route)});
  final path = uri.path.isEmpty ? '/' : uri.path;
${routeArms}
  return MaterialPageRoute<void>(
    settings: settings,
    builder: (_) => const Scaffold(
      body: SafeArea(
        child: Center(child: Text('Page not found')),
      ),
    ),
  );
}

Map<String, String>? _matchOpenPencilRoute(String pattern, String path) {
  final patternSegments = Uri(path: pattern).pathSegments;
  final pathSegments = Uri(path: path).pathSegments;
  if (patternSegments.length != pathSegments.length) return null;
  final params = <String, String>{};
  for (var index = 0; index < patternSegments.length; index++) {
    final expected = patternSegments[index];
    final actual = pathSegments[index];
    if (expected.startsWith(':')) {
      params[expected.substring(1)] = actual;
    } else if (expected != actual) {
      return null;
    }
  }
  return params;
}
`
}

export function buildFlutterRuntime(docStates: readonly IRDocStateDecl[]): string {
  const defaults = Object.fromEntries(
    docStates.map((state) => [state.name, safeNativeStateDefault(state)])
  )
  const readOnlyNames = docStates
    .filter((state) => state.computed || state.computedInvalid)
    .map((state) => dartString(state.name))
    .join(', ')
  return `import 'package:flutter/material.dart';

class OpenPencilDocumentState extends ChangeNotifier {
  OpenPencilDocumentState._();

  static final OpenPencilDocumentState instance = OpenPencilDocumentState._();

  final Map<String, dynamic> _values = ${dartLiteral(defaults)};
  static const Set<String> _readOnlyNames = <String>{${readOnlyNames}};

  dynamic getValue(String name) => _values[name];

  void setValue(String name, dynamic value) {
    if (_readOnlyNames.contains(name)) return;
    _values[name] = value;
    notifyListeners();
  }

  void updateValue(String name, dynamic Function(dynamic previous) update) {
    if (_readOnlyNames.contains(name)) return;
    _values[name] = update(_values[name]);
    notifyListeners();
  }
}

abstract final class OpenPencilRuntime {
  static dynamic member(dynamic value, String property) {
    if (value is Map) return value[property];
    if (value is List && property == 'length') return value.length;
    if (value is String && property == 'length') return value.length;
    return null;
  }

  static bool truthy(dynamic value) {
    if (value == null || value == false) return false;
    if (value is num) return value != 0 && !value.isNaN;
    if (value is String) return value.isNotEmpty;
    return true;
  }

  static String text(dynamic value) => value == null ? '' : value.toString();

  static num number(dynamic value) {
    if (value is num && value.isFinite) return value;
    return num.tryParse(text(value)) ?? 0;
  }

  static dynamic add(dynamic left, dynamic right) {
    if (left is String || right is String) return text(left) + text(right);
    return number(left) + number(right);
  }

  static dynamic arithmetic(String operator, dynamic left, dynamic right) {
    final a = number(left);
    final b = number(right);
    switch (operator) {
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return b == 0 ? 0 : a / b;
      case '%':
        return b == 0 ? 0 : a % b;
      default:
        return 0;
    }
  }

  static bool equals(dynamic left, dynamic right) => left == right;

  static bool compare(String operator, dynamic left, dynamic right) {
    final a = left is num ? left : text(left);
    final b = right is num ? right : text(right);
    final comparison = a is num && b is num ? a.compareTo(b) : text(a).compareTo(text(b));
    switch (operator) {
      case '<':
        return comparison < 0;
      case '<=':
        return comparison <= 0;
      case '>':
        return comparison > 0;
      case '>=':
        return comparison >= 0;
      default:
        return false;
    }
  }

  static dynamic and(dynamic left, dynamic right) => truthy(left) ? right : left;
  static dynamic or(dynamic left, dynamic right) => truthy(left) ? left : right;

  static List<dynamic> list(dynamic value) => value is List ? value : const <dynamic>[];

  static String route(String pattern, Map<String, dynamic> params) {
    final uri = Uri.tryParse(pattern);
    if (uri == null) return '/__openpencil_invalid_route__';
    final segments = <String>[];
    for (final segment in uri.pathSegments) {
      if (!segment.startsWith(':')) {
        segments.add(segment);
        continue;
      }
      final name = segment.substring(1);
      if (!params.containsKey(name)) return '/__openpencil_invalid_route__';
      segments.add(text(params[name]));
    }
    return Uri(pathSegments: segments, query: uri.hasQuery ? uri.query : null, fragment: uri.hasFragment ? uri.fragment : null).toString();
  }

  static Widget safeNetworkImage(
    dynamic source, {
    BoxFit fit = BoxFit.cover,
    String? semanticLabel,
  }) {
    final uri = Uri.tryParse(text(source));
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty || uri.userInfo.isNotEmpty) {
      return const SizedBox.shrink();
    }
    return Image.network(
      uri.toString(),
      fit: fit,
      semanticLabel: semanticLabel,
      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
    );
  }
}
`
}

export function buildFlutterReadme(options: CompilerOptions, router: boolean): string {
  const packageName = dartPackageName(options.packageName)
  return `# OpenPencil Flutter export

This directory contains **source-only** Flutter code generated by OpenPencil. It intentionally does not contain version-sensitive Android, iOS, macOS, Windows, Linux, or web platform shells.

## Create platform shells and run

Use a Flutter SDK compatible with Dart 3.3 or newer. From this directory, first generate the platform directories, then resolve packages:

\`\`\`sh
flutter create --platforms=android,ios --project-name ${packageName} --no-pub .
flutter pub get
dart format lib test
flutter analyze
flutter run
\`\`\`

Review the generated diff after \`flutter create\`; the exported \`lib/\`, \`assets/\`, and \`pubspec.yaml\` are the source of truth and should be backed up before regenerating platform shells.

## Static MVP boundary

The export uses native Flutter Widgets, not a WebView. It supports basic layout, text, raster images, buttons, text inputs, local/document state, local lists, and a safe subset of actions.${
    router
      ? ' Multiple pages use a centralized `onGenerateRoute` callback and `MaterialPageRoute`, preserving the Navigator back stack.'
      : ' Router-free output contains only the first selected page.'
  }

Unsupported web, plugin, remote-data, motion, upload, and advanced-form behavior is omitted and listed in the compiler warnings. OpenPencil did not run CocoaPods, Gradle, signing, a simulator, or a physical-device build.
`
}

export function buildFlutterAnalysisOptions(): string {
  return `analyzer:
  exclude:
    - build/**
`
}

export function buildFlutterWidgetTest(options: CompilerOptions): string {
  const packageName = dartPackageName(options.packageName)
  return `import 'package:flutter_test/flutter_test.dart';
import 'package:${packageName}/main.dart';

void main() {
  testWidgets('OpenPencil app mounts', (tester) async {
    await tester.pumpWidget(const OpenPencilApp());
    expect(find.byType(OpenPencilApp), findsOneWidget);
  });
}
`
}

export function buildFlutterGitignore(): string {
  return [
    '.dart_tool/',
    '.flutter-plugins',
    '.flutter-plugins-dependencies',
    '.packages',
    'build/',
    'coverage/',
    'android/.gradle/',
    'ios/Pods/',
    '*.iml',
    ''
  ].join('\n')
}
