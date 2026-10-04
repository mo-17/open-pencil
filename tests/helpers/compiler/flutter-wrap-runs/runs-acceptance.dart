// Generated-project acceptance template. Only the fixture metadata is substituted.
// Runs are calculated from authored child sizes, never inferred from their cross positions.
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:{{PACKAGE}}/{{PAGE_FILE}}';

class RunCase {
  const RunCase({
    required this.direction,
    required this.alignment,
    required this.kind,
    required this.containerId,
    required this.childIds,
    this.mainSpacing = 12,
    this.runSpacing = 16,
  });

  final Axis direction;
  final WrapAlignment alignment;
  final String kind;
  final String containerId;
  final List<String> childIds;
  final double mainSpacing;
  final double runSpacing;
}

const runCases = <RunCase>[
  {{RUN_CASES_DART}}
];
const screenKey = ValueKey('wrap-runs-acceptance-screen');
const tolerance = 0.6;
const widths = [360.0, 390.0, 430.0, 600.0];

Finder node(String id) => find.byKey(ValueKey('openpencil-node-$id'));

Rect visualRect(WidgetTester tester, Finder finder) {
  final box = tester.renderObject<RenderBox>(finder);
  return Rect.fromPoints(
    box.localToGlobal(Offset.zero),
    box.localToGlobal(box.size.bottomRight(Offset.zero)),
  );
}

Future<void> mount(
  WidgetTester tester,
  Size size, {
  TextDirection direction = TextDirection.ltr,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  await tester.pumpWidget(MaterialApp(
    home: Directionality(
      textDirection: direction,
      child: RepaintBoundary(
        key: screenKey,
        child: MediaQuery(
          data: MediaQueryData(
            size: size,
            devicePixelRatio: 1,
            textScaler: TextScaler.linear(1),
          ),
          child: const {{PAGE_CLASS}}(),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void restoreView(WidgetTester tester) {
  tester.view.resetPhysicalSize();
  tester.view.resetDevicePixelRatio();
}

void expectNoLayoutException(WidgetTester tester) {
  expect(tester.takeException(), isNull);
}

double mainExtent(Rect rect, Axis axis) => axis == Axis.horizontal ? rect.width : rect.height;
double crossExtent(Rect rect, Axis axis) => axis == Axis.horizontal ? rect.height : rect.width;

double mainOffset(Rect child, Rect parent, Axis axis, TextDirection direction) {
  if (axis == Axis.vertical) return child.top - parent.top;
  return direction == TextDirection.rtl ? parent.right - child.right : child.left - parent.left;
}

double crossOffset(Rect child, Rect parent, Axis axis, TextDirection direction) {
  if (axis == Axis.horizontal) return child.top - parent.top;
  return direction == TextDirection.rtl ? parent.right - child.right : child.left - parent.left;
}

List<double> authoredMainSizes(RunCase fixture) {
  if (fixture.direction == Axis.vertical) return const [48, 48, 48];
  final size = fixture.kind == 'three' ? 220.0 : fixture.kind == 'single' ? 60.0 : 140.0;
  return [size, size, size];
}

const authoredCrossSizes = [24.0, 40.0, 32.0];

double authoredFixedHeight(RunCase fixture) {
  final horizontal = fixture.direction == Axis.horizontal;
  if (fixture.kind == 'three') return horizontal ? 220 : 72;
  if (fixture.kind == 'single') return horizontal ? 120 : 200;
  if (fixture.kind == 'overflow') return 40;
  return horizontal ? 180 : 120;
}

List<List<int>> calculateRuns(List<double> sizes, double available, RunCase fixture) {
  final runs = <List<int>>[];
  double occupied = 0;
  for (var index = 0; index < sizes.length; index++) {
    final size = sizes[index];
    if (runs.isEmpty || occupied + fixture.mainSpacing + size > available + 0.000001) {
      runs.add(<int>[]);
      occupied = 0;
    }
    if (runs.last.isNotEmpty) occupied += fixture.mainSpacing;
    occupied += size;
    runs.last.add(index);
  }
  return runs;
}

int expectRunGeometry(
  WidgetTester tester,
  RunCase fixture,
  TextDirection direction,
  double viewportWidth,
) {
  final container = visualRect(tester, node(fixture.containerId));
  final children = fixture.childIds.map((id) => visualRect(tester, node(id))).toList();
  expect(children, hasLength(3));
  expect(container.width.isFinite && container.height.isFinite, isTrue);
  // Every container fills the authored screen's 24px left/right padding.
  expect(container.width, closeTo(viewportWidth - 48, tolerance));
  if (fixture.kind != 'hug') {
    expect(container.height, closeTo(authoredFixedHeight(fixture), tolerance));
  }
  final axis = fixture.direction;
  final available = mainExtent(container, axis);
  final expectedMainSizes = authoredMainSizes(fixture);
  for (var index = 0; index < children.length; index++) {
    final child = children[index];
    expect(child.width.isFinite && child.height.isFinite, isTrue);
    expect(mainExtent(child, axis), closeTo(expectedMainSizes[index], tolerance));
    expect(crossExtent(child, axis), closeTo(authoredCrossSizes[index], tolerance));
    expect(mainExtent(child, axis), lessThanOrEqualTo(available + tolerance));
  }
  final runs = calculateRuns(expectedMainSizes, available, fixture);
  final runCrossSizes = runs.map((indices) => indices
      .map((index) => authoredCrossSizes[index])
      .reduce(math.max)).toList();
  final naturalCross = runCrossSizes.reduce((left, right) => left + right)
      + fixture.runSpacing * (runs.length - 1);
  final free = math.max(0.0, crossExtent(container, axis) - naturalCross);
  // spaceBetween with one run falls back to logical start. Overflow cannot create negative gaps.
  final extraGap = fixture.alignment == WrapAlignment.spaceBetween && runs.length > 1
      ? free / (runs.length - 1)
      : 0.0;
  double runStart = 0;
  for (var runIndex = 0; runIndex < runs.length; runIndex++) {
    double childStart = 0;
    for (final index in runs[runIndex]) {
      final child = children[index];
      expect(mainOffset(child, container, axis, direction), closeTo(childStart, tolerance),
          reason: '${fixture.kind}/${fixture.alignment}: main position of child $index');
      expect(crossOffset(child, container, axis, direction), closeTo(runStart, tolerance),
          reason: '${fixture.kind}/${fixture.alignment}: run position of child $index');
      expect(mainOffset(child, container, axis, direction), greaterThanOrEqualTo(-tolerance));
      expect(mainOffset(child, container, axis, direction) + mainExtent(child, axis),
          lessThanOrEqualTo(available + tolerance));
      expect(crossOffset(child, container, axis, direction), greaterThanOrEqualTo(-tolerance));
      if (fixture.kind != 'overflow') {
        expect(crossOffset(child, container, axis, direction) + crossExtent(child, axis),
            lessThanOrEqualTo(crossExtent(container, axis) + tolerance));
      }
      childStart += expectedMainSizes[index] + fixture.mainSpacing;
    }
    runStart += runCrossSizes[runIndex] + fixture.runSpacing + extraGap;
  }
  if (fixture.kind == 'hug') {
    expect(crossExtent(container, axis), closeTo(naturalCross, tolerance));
  }
  if (fixture.alignment == WrapAlignment.spaceBetween && runs.length > 1 && free > tolerance) {
    final finalRunStart = runStart - runCrossSizes.last - fixture.runSpacing - extraGap;
    expect(finalRunStart + runCrossSizes.last, closeTo(crossExtent(container, axis), tolerance));
  }
  return runs.length;
}

Future<void> verifyCases(WidgetTester tester, TextDirection direction, double width) async {
  for (final fixture in runCases) {
    await tester.ensureVisible(node(fixture.containerId));
    await tester.pumpAndSettle();
    final runCount = expectRunGeometry(tester, fixture, direction, width);
    if (width <= 430) {
      final expected = fixture.kind == 'single' ? 1 : fixture.kind == 'three' ? 3 : 2;
      expect(runCount, expected, reason: '${fixture.direction}/${fixture.kind}: authored run count');
    }
    expectNoLayoutException(tester);
  }
}

Future<void> increment(WidgetTester tester) async {
  await tester.ensureVisible(node('{{BUTTON_ID}}'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Increment +1'));
  await tester.pumpAndSettle();
}

Future<void> loadScreenshotFont() async {
  final bytes = await File('{{ROBOTO_FONT}}').readAsBytes();
  final loader = FontLoader('Roboto')
    ..addFont(Future<ByteData>.value(
      ByteData.view(bytes.buffer, bytes.offsetInBytes, bytes.lengthInBytes),
    ));
  await loader.load();
}

Future<void> captureComparison(WidgetTester tester) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(screenKey));
  final image = await boundary.toImage(pixelRatio: 1);
  try {
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    expect(png, isNotNull);
    await Directory('screenshots').create(recursive: true);
    await File('screenshots/390-auto-between.png').writeAsBytes(
      png!.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes),
    );
  } finally {
    image.dispose();
  }
}

void main() {
  test('fixture covers axes, run distributions and Hug/overflow boundaries', () {
    expect(runCases, hasLength(16));
    final signatures = runCases
        .map((fixture) => '${fixture.direction}/${fixture.alignment}/${fixture.kind}')
        .toSet();
    expect(signatures, hasLength(16));
    for (final axis in Axis.values) {
      for (final alignment in [WrapAlignment.start, WrapAlignment.spaceBetween]) {
        for (final kind in ['two', 'three', 'single']) {
          expect(signatures, contains('$axis/$alignment/$kind'));
        }
      }
    }
    for (final alignment in [WrapAlignment.start, WrapAlignment.spaceBetween]) {
      for (final kind in ['hug', 'overflow']) {
        expect(signatures, contains('${Axis.horizontal}/$alignment/$kind'));
      }
    }
  });

  for (final width in widths) {
    for (final direction in TextDirection.values) {
      testWidgets('16 generated run rect cases at width $width, $direction', (tester) async {
        addTearDown(() => restoreView(tester));
        await mount(tester, Size(width, 844), direction: direction);
        expectNoLayoutException(tester);
        await verifyCases(tester, direction, width);
      });
    }
  }

  testWidgets('counter state survives rewrapping and direction changes', (tester) async {
    addTearDown(() => restoreView(tester));
    await mount(tester, const Size(360, 844));
    expect(find.text('Count: 0'), findsOneWidget);
    await increment(tester);
    expect(find.text('Count: 1'), findsOneWidget);
    for (final width in widths) {
      final direction = width == 390 || width == 600 ? TextDirection.rtl : TextDirection.ltr;
      await mount(tester, Size(width, 844), direction: direction);
      expect(find.text('Count: 1'), findsOneWidget);
      expect(visualRect(tester, node('{{COUNT_ID}}')).width.isFinite, isTrue);
      await verifyCases(tester, direction, width);
    }
    await increment(tester);
    expect(find.text('Count: 2'), findsOneWidget);
    expectNoLayoutException(tester);
  });

  testWidgets('render a readable 390px Auto/Space between comparison', (tester) async {
    addTearDown(() => restoreView(tester));
    await tester.runAsync(loadScreenshotFont);
    await mount(tester, const Size(390, 844));
    final pair = runCases.where((fixture) =>
        fixture.direction == Axis.horizontal && fixture.kind == 'two').toList();
    expect(pair, hasLength(2));
    await Scrollable.ensureVisible(tester.element(node(pair.last.containerId)), alignment: 1);
    await tester.pumpAndSettle();
    final viewport = visualRect(tester, find.byType(Scrollable).first);
    for (final fixture in pair) {
      final rect = visualRect(tester, node(fixture.containerId));
      expect(rect.top, greaterThanOrEqualTo(viewport.top - tolerance));
      expect(rect.bottom, lessThanOrEqualTo(viewport.bottom + tolerance));
      expectRunGeometry(tester, fixture, TextDirection.ltr, 390);
    }
    expectNoLayoutException(tester);
    await tester.runAsync(() => captureComparison(tester));
    expectNoLayoutException(tester);
  });
}
