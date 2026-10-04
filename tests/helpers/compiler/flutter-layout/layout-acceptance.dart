// Generated-project acceptance template. The host substitutes only fixture metadata.
// This file exercises the compiler output; it does not replace generated widgets.
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:{{PACKAGE}}/{{PAGE_FILE}}';

enum MainPlacement { min, max, center, spaceBetween }
enum CrossPlacement { min, max, center }

class LayoutWrapCase {
  const LayoutWrapCase({
    required this.horizontal,
    required this.main,
    required this.cross,
    required this.containerId,
    required this.childIds,
    this.spacing = 12,
    this.runSpacing = 16,
  });

  final bool horizontal;
  final MainPlacement main;
  final CrossPlacement cross;
  final String containerId;
  final List<String> childIds;
  final double spacing;
  final double runSpacing;
}

const wrapCases = <LayoutWrapCase>[
  {{WRAP_CASES_DART}}
];
const screenKey = ValueKey('layout-acceptance-screen');
const tolerance = 0.6;

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
  double textScale = 1,
  double keyboard = 0,
  EdgeInsets safe = EdgeInsets.zero,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  await tester.pumpWidget(MaterialApp(
    home: RepaintBoundary(
      key: screenKey,
      child: MediaQuery(
        data: MediaQueryData(
          size: size,
          devicePixelRatio: 1,
          textScaler: TextScaler.linear(textScale),
          padding: safe,
          viewPadding: safe,
          viewInsets: EdgeInsets.only(bottom: keyboard),
        ),
        child: const {{PAGE_CLASS}}(),
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

double mainStart(Rect rect, bool horizontal) => horizontal ? rect.left : rect.top;
double crossStart(Rect rect, bool horizontal) => horizontal ? rect.top : rect.left;
double mainSize(Rect rect, bool horizontal) => horizontal ? rect.width : rect.height;
double crossSize(Rect rect, bool horizontal) => horizontal ? rect.height : rect.width;

double leadingSpace(MainPlacement alignment, double free) => switch (alignment) {
  MainPlacement.min || MainPlacement.spaceBetween => 0,
  MainPlacement.max => free,
  MainPlacement.center => free / 2,
};

double crossOffset(CrossPlacement alignment, double free) => switch (alignment) {
  CrossPlacement.min => 0,
  CrossPlacement.max => free,
  CrossPlacement.center => free / 2,
};

void expectWrapGeometry(WidgetTester tester, LayoutWrapCase fixture) {
  expect(fixture.childIds, hasLength(3));
  final container = visualRect(tester, node(fixture.containerId));
  final children = fixture.childIds.map((id) => visualRect(tester, node(id))).toList();
  final horizontal = fixture.horizontal;
  final first = children[0];
  final second = children[1];
  final third = children[2];
  final available = mainSize(container, horizontal);
  final firstSize = mainSize(first, horizontal);
  final secondSize = mainSize(second, horizontal);
  final thirdSize = mainSize(third, horizontal);
  final firstRunLength = firstSize + fixture.spacing + secondSize;
  // The authored fixture intentionally makes exactly two items fit the first run.
  expect(firstRunLength, lessThanOrEqualTo(available + tolerance));
  expect(firstRunLength + fixture.spacing + thirdSize, greaterThan(available + tolerance));
  final firstFree = available - firstRunLength;
  final firstLeading = leadingSpace(fixture.main, firstFree);
  final actualGap = fixture.main == MainPlacement.spaceBetween
      ? fixture.spacing + firstFree
      : fixture.spacing;
  final origin = mainStart(container, horizontal);
  expect(mainStart(first, horizontal), closeTo(origin + firstLeading, tolerance));
  expect(mainStart(second, horizontal),
      closeTo(origin + firstLeading + firstSize + actualGap, tolerance));
  // A single-item spaceBetween run starts at the leading edge.
  final thirdLeading = leadingSpace(fixture.main, available - thirdSize);
  expect(mainStart(third, horizontal), closeTo(origin + thirdLeading, tolerance));
  final firstRunCross = math.max(crossSize(first, horizontal), crossSize(second, horizontal));
  final crossOrigin = crossStart(container, horizontal);
  expect(crossStart(first, horizontal), closeTo(
      crossOrigin + crossOffset(fixture.cross, firstRunCross - crossSize(first, horizontal)), tolerance));
  expect(crossStart(second, horizontal), closeTo(
      crossOrigin + crossOffset(fixture.cross, firstRunCross - crossSize(second, horizontal)), tolerance));
  expect(crossStart(third, horizontal),
      closeTo(crossOrigin + firstRunCross + fixture.runSpacing, tolerance));
  for (final child in children) {
    expect(child.width.isFinite && child.height.isFinite, isTrue);
    expect(child.left, greaterThanOrEqualTo(container.left - tolerance));
    expect(child.right, lessThanOrEqualTo(container.right + tolerance));
    expect(child.top, greaterThanOrEqualTo(container.top - tolerance));
    expect(child.bottom, lessThanOrEqualTo(container.bottom + tolerance));
  }
}

Future<void> increment(WidgetTester tester) async {
  await tester.ensureVisible(node('{{BUTTON_ID}}'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Increment +1'));
  await tester.pumpAndSettle();
}

Future<void> captureScreen(WidgetTester tester) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(screenKey));
  final image = await boundary.toImage(pixelRatio: 1);
  try {
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    expect(png, isNotNull);
    await Directory('screenshots').create(recursive: true);
    await File('screenshots/390.png').writeAsBytes(
      png!.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes),
    );
  } finally {
    image.dispose();
  }
}

void main() {
  test('fixture covers both axes and all supported main/cross combinations', () {
    expect(wrapCases, hasLength(24));
    final signatures = wrapCases
        .map((fixture) => '${fixture.horizontal}/${fixture.main}/${fixture.cross}')
        .toSet();
    expect(signatures, hasLength(24));
    for (final horizontal in [true, false]) {
      for (final main in MainPlacement.values) {
        for (final cross in CrossPlacement.values) {
          expect(signatures, contains('$horizontal/$main/$cross'));
        }
      }
    }
  });

  for (final width in [360.0, 390.0, 430.0]) {
    testWidgets('24 Wrap rect cases, normalized constraints and null clearing at width $width', (tester) async {
      addTearDown(() => restoreView(tester));
      await mount(tester, Size(width, 844));
      expectNoLayoutException(tester);
      final constrained = visualRect(tester, node('{{NORMALIZED_LIMIT_ID}}'));
      expect(constrained.width, closeTo({{NORMALIZED_WIDTH}}, tolerance));
      // The fixture also authors minHeight 40 / maxHeight 20.
      expect(constrained.height, closeTo(40, tolerance));
      expect(constrained.width.isFinite && constrained.height.isFinite, isTrue);
      final cleared = visualRect(tester, node('{{CLEARED_LIMIT_ID}}'));
      // The cleared FILL node is a direct child of the authored 24px-padded screen.
      expect(cleared.width, closeTo(width - 48, tolerance));
      for (final fixture in wrapCases) {
        await tester.ensureVisible(node(fixture.containerId));
        await tester.pumpAndSettle();
        expectWrapGeometry(tester, fixture);
        expectNoLayoutException(tester);
      }
    });
  }

  const sizes = <Size>[
    Size(360, 740), Size(390, 844), Size(430, 932),
    Size(600, 900), Size(844, 390),
  ];
  testWidgets('counter state survives responsive width and orientation changes', (tester) async {
    addTearDown(() => restoreView(tester));
    await mount(tester, sizes.first);
    expect(find.text('Count: 0'), findsOneWidget);
    await increment(tester);
    expect(find.text('Count: 1'), findsOneWidget);
    for (final size in sizes) {
      await mount(tester, size);
      expect(find.text('Count: 1'), findsOneWidget);
      expect(visualRect(tester, node('{{COUNT_ID}}')).width.isFinite, isTrue);
      expectNoLayoutException(tester);
    }
    await increment(tester);
    expect(find.text('Count: 2'), findsOneWidget);
    expectNoLayoutException(tester);
  });

  for (final size in sizes) {
    testWidgets('system scale 2, keyboard 300 and SafeArea 47/34 at $size', (tester) async {
      addTearDown(() => restoreView(tester));
      const safe = EdgeInsets.only(top: 47, bottom: 34);
      await mount(tester, size, textScale: 2, keyboard: 300, safe: safe);
      expectNoLayoutException(tester);
      final button = visualRect(tester, node('{{BUTTON_ID}}'));
      final label = visualRect(tester, find.text('Increment +1'));
      if (size.width <= 390) expect(button.height, greaterThan(48));
      expect(label.left, greaterThanOrEqualTo(button.left - tolerance));
      expect(label.right, lessThanOrEqualTo(button.right + tolerance));
      expect(label.top, greaterThanOrEqualTo(button.top - tolerance));
      expect(label.bottom, lessThanOrEqualTo(button.bottom + tolerance));
      final labelContext = tester.element(find.text('Increment +1'));
      expect(MediaQuery.textScalerOf(labelContext).scale(10), closeTo(20, tolerance));
      final cleared = visualRect(tester, node('{{CLEARED_LIMIT_ID}}'));
      expect(cleared.width, closeTo(size.width - 48, tolerance));
      expect(cleared.height.isFinite && cleared.height > 0, isTrue);
      if (size.width <= 430) expect(cleared.height, greaterThan(48));
      final clearedText = visualRect(tester, find.text('Compact clears inherited limits'));
      expect(clearedText.left, greaterThanOrEqualTo(cleared.left - tolerance));
      expect(clearedText.right, lessThanOrEqualTo(cleared.right + tolerance));
      expect(clearedText.top, greaterThanOrEqualTo(cleared.top - tolerance));
      expect(clearedText.bottom, lessThanOrEqualTo(cleared.bottom + tolerance));
      await tester.ensureVisible(node('{{FOOTER_ID}}'));
      await tester.pumpAndSettle();
      final footer = visualRect(tester, node('{{FOOTER_ID}}'));
      final scrollableFinder = find.byType(Scrollable).first;
      final viewport = visualRect(tester, scrollableFinder);
      expect(viewport.top, greaterThanOrEqualTo(47 - tolerance));
      expect(viewport.bottom, lessThanOrEqualTo(size.height - 300 + tolerance));
      expect(footer.overlaps(viewport), isTrue);
      if (footer.height <= viewport.height + tolerance) {
        expect(footer.top, greaterThanOrEqualTo(viewport.top - tolerance));
        expect(footer.bottom, lessThanOrEqualTo(viewport.bottom + tolerance));
      }
      final scrollable = tester.state<ScrollableState>(scrollableFinder);
      expect(scrollable.position.maxScrollExtent, greaterThan(0));
      expectNoLayoutException(tester);
    });
  }

  testWidgets('save an actual first-screen render at width 390', (tester) async {
    addTearDown(() => restoreView(tester));
    await mount(tester, const Size(390, 844));
    expectNoLayoutException(tester);
    await tester.runAsync(() => captureScreen(tester));
    expectNoLayoutException(tester);
  });
}
