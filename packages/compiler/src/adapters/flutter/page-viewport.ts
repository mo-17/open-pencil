import type { IRPageViewport } from '#compiler/ir/types'

import { flutterColor } from './style'

export function emitFlutterViewport(viewport: IRPageViewport, body: string): string {
  return `OpenPencilPageViewport(
  fitWidth: ${viewport.mode === 'fit-width'},
  designWidth: ${viewport.designWidth},
  designHeight: ${viewport.designHeight},
  backgroundColor: ${flutterColor(viewport.backgroundColor) ?? 'Colors.transparent'},
  builder: (context, opViewportWidth) => ${body},
)`
}

/** Self-contained generated Widgets; responsive pages measure their SafeArea parent. */
export function buildFlutterPageViewport(): string {
  return `import 'package:flutter/material.dart';

class OpenPencilViewportScope extends InheritedWidget {
  const OpenPencilViewportScope({super.key, required this.width, required super.child});
  final double width;
  static double? maybeWidthOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<OpenPencilViewportScope>()?.width;
  @override
  bool updateShouldNotify(OpenPencilViewportScope oldWidget) => oldWidget.width != width;
}

class OpenPencilPageViewport extends StatelessWidget {
  const OpenPencilPageViewport({super.key, required this.fitWidth,
    required this.designWidth, required this.designHeight,
    required this.backgroundColor, required this.builder});
  final bool fitWidth;
  final double designWidth;
  final double designHeight;
  final Color backgroundColor;
  final Widget Function(BuildContext, double) builder;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) {
    final width = constraints.hasBoundedWidth ? constraints.maxWidth : designWidth;
    final height = constraints.hasBoundedHeight ? constraints.maxHeight : 0.0;
    final content = fitWidth
      ? SizedBox(width: width, height: designHeight * width / designWidth,
          child: FittedBox(fit: BoxFit.fill, alignment: Alignment.topLeft,
            child: SizedBox(width: designWidth, height: designHeight,
              child: builder(context, designWidth))))
      : OpenPencilViewportScope(width: width, child: builder(context, width));
    return ColoredBox(color: backgroundColor,
      child: SingleChildScrollView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        child: ConstrainedBox(constraints: BoxConstraints(minHeight: height),
          child: SizedBox(width: width, child: content))));
  });
}

/// FILL is bounded by its local parent; a scrolling axis remains content-sized.
class OpenPencilFill extends StatelessWidget {
  const OpenPencilFill({super.key, this.width = false, this.height = false, required this.child});
  final bool width;
  final bool height;
  final Widget child;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) =>
    SizedBox(width: width && constraints.hasBoundedWidth ? constraints.maxWidth : null,
      height: height && constraints.hasBoundedHeight ? constraints.maxHeight : null, child: child));
}

/// Natural width keeps free-positioned HUG containers finite inside an unbounded Row.
class OpenPencilStack extends StatelessWidget {
  const OpenPencilStack({super.key, required this.naturalWidth,
    required this.minimumHeight, this.flow, required this.children});
  final double naturalWidth;
  final double minimumHeight;
  final Widget? flow;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) =>
    SizedBox(width: constraints.hasBoundedWidth ? constraints.maxWidth : naturalWidth,
      height: flow == null ? minimumHeight : null,
      child: Stack(clipBehavior: Clip.none, children: [
        if (flow != null) ConstrainedBox(constraints: BoxConstraints(minHeight: minimumHeight), child: flow),
        ...children])));
}

class OpenPencilFlexItem {
  const OpenPencilFlexItem({this.flex = 0, required this.child});
  final int flex;
  final Widget child;
}

class OpenPencilFlex extends StatelessWidget {
  const OpenPencilFlex({super.key, required this.axis, required this.children,
    this.gap = 0, this.mainAxisAlignment = MainAxisAlignment.start,
    this.crossAxisAlignment = CrossAxisAlignment.start});
  final Axis axis;
  final List<OpenPencilFlexItem> children;
  final double gap;
  final MainAxisAlignment mainAxisAlignment;
  final CrossAxisAlignment crossAxisAlignment;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) {
    final bounded = axis == Axis.horizontal ? constraints.hasBoundedWidth : constraints.hasBoundedHeight;
    final crossBounded = axis == Axis.horizontal ? constraints.hasBoundedHeight : constraints.hasBoundedWidth;
    final widgets = <Widget>[];
    for (final item in children) {
      if (widgets.isNotEmpty && gap > 0) {
        widgets.add(SizedBox(width: axis == Axis.horizontal ? gap : null,
          height: axis == Axis.vertical ? gap : null));
      }
      // Expanded must be a direct Flex child. Never allocate infinite scroll height.
      widgets.add(bounded && item.flex > 0 ? Expanded(flex: item.flex, child: item.child) : item.child);
    }
    return Flex(direction: axis, mainAxisSize: bounded && children.any((item) => item.flex > 0)
      ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: mainAxisAlignment,
      crossAxisAlignment: !crossBounded && crossAxisAlignment == CrossAxisAlignment.stretch
        ? CrossAxisAlignment.start : crossAxisAlignment,
      children: widgets);
  });
}

/// Source-order FIXED/FR columns; the compiler warns for explicit cell placement.
class OpenPencilGrid extends StatelessWidget {
  const OpenPencilGrid({super.key, required this.columnTracks, required this.children,
    this.gap = 0, this.runGap = 0});
  final List<double> columnTracks;
  final List<Widget> children;
  final double gap;
  final double runGap;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) {
    final width = constraints.hasBoundedWidth ? constraints.maxWidth : 0.0;
    final fixed = columnTracks.where((track) => track >= 0).fold(0.0, (sum, track) => sum + track);
    final fractions = columnTracks.where((track) => track < 0).fold(0.0, (sum, track) => sum - track);
    final remaining = (width - fixed - gap * (columnTracks.length - 1)).clamp(0.0, double.infinity);
    return Wrap(spacing: gap, runSpacing: runGap, children: [
      for (var index = 0; index < children.length; index++)
        SizedBox(width: columnTracks[index % columnTracks.length] >= 0
          ? columnTracks[index % columnTracks.length]
          : remaining * -columnTracks[index % columnTracks.length] / fractions,
          child: children[index])]);
  });
}
`
}
