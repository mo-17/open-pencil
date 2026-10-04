import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openpencil_application_acceptance/main.dart';

const screenKey = ValueKey('application-acceptance-screen');

void main() {
  setUpAll(() async {
    final bytes = await File('{{ROBOTO_FONT}}').readAsBytes();
    final loader = FontLoader('Roboto')..addFont(Future.value(ByteData.sublistView(bytes)));
    await loader.load();
  });

  testWidgets('application starts at Home, keeps its entry origin and shares state across real Navigator routes', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(const RepaintBoundary(key: screenKey, child: OpenPencilApp()));
    await tester.pumpAndSettle();
    expect(find.text('Home screen'), findsOneWidget);
    expect(find.text('REFERENCE ONLY'), findsNothing);
    expect(find.text('OUTSIDE ENTRY'), findsNothing);
    final entry = find.byKey(const ValueKey('openpencil-node-{{HOME_ENTRY_ID}}'));
    expect(tester.getTopLeft(entry).dx, closeTo(0, 0.5));
    expect(tester.getTopLeft(entry).dy, closeTo(0, 0.5));
    await tester.tap(find.text('Increment shared count'));
    await tester.pumpAndSettle();
    expect(find.text('Shared count: 1'), findsOneWidget);
    await tester.tap(find.text('Open products'));
    await tester.pumpAndSettle();
    expect(find.text('Products screen'), findsOneWidget);
    expect(find.text('Shared count: 1'), findsOneWidget);
    await tester.tap(find.text('Return home'));
    await tester.pumpAndSettle();
    expect(find.text('Home screen'), findsOneWidget);
    expect(find.text('Shared count: 1'), findsOneWidget);
    expect(tester.takeException(), isNull);
    final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(screenKey));
    final image = await boundary.toImage(pixelRatio: 1);
    await tester.runAsync(() async {
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      if (data == null) throw StateError('Missing screenshot bytes');
      await Directory('screenshots').create(recursive: true);
      await File('screenshots/application-home.png').writeAsBytes(data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes));
    });
    image.dispose();
  });
}
