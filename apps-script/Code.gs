// CMT Slide Builder — Google Apps Script Web App
// 5 structured layouts + slot-based layouts + freeform custom
// Supports: deckConfig (theme tokens), transitions, conditional footer
// Rules: white bg, blue (#1a80d7) titles, Helvetica Neue, bottom 42px footer zone

// ═══════════════════════════════════════════════════════════════
// DEFAULT THEME (overridable via deckConfig)
// ═══════════════════════════════════════════════════════════════

var DEFAULT_THEME = {
  accentColor: '#1a80d7',
  accentDark: '#0D4A8A',
  accentMid: '#1463AC',
  accentLight: '#3A9BE8',
  accentVeryLight: '#D7DFF1',
  bodyColor: '#000000',
  subtleColor: '#9CA3AF',
  darkAccent: '#515B73',
  lightBg: '#F3F4F6',
  midGray: '#E5E7EB',
  white: '#FFFFFF',
  font: 'Helvetica Neue',
  titleSize: 28,
  bodySize: 16
};

var T = {}; // Active theme — set per presentation in buildPresentation()

function doGet(e) {
  if (e && e.parameter && e.parameter.data) {
    try {
      var data = JSON.parse(e.parameter.data);
      var url = buildPresentation(data.title || 'Presentation', data.slides || [], data.deckConfig || {});
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, url: url }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'CMT Slides API is running. Send ?data={...}' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var url = buildPresentation(data.title || 'Presentation', data.slides || [], data.deckConfig || {});
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, url: url }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function testBuild() {
  var url = buildPresentation('Feature Test', [
    { title: 'Market Opportunity', body: '20M|Unconnected commercial vehicles\n<5%|Policies priced with telematics\n109%|Combined ratio trending', layout: 'metrics' },
    { title: '4.0x', body: 'Predictive lift over traditional rating variables', layout: 'fact' },
    { layout: 'quote', body: 'Every mile is a chance to save a life. Telematics turns raw driving data into actionable safety insights.', title: 'Dr. Hari Balakrishnan, CTO' },
    { layout: 'image-right', title: 'BYOD Transforms Fragmented Signals', body: '- Streamlined digital consent workflow\n- 70+ TSP integrations\n- 90% market coverage by 2026', image: 'Architecture diagram: TSP Sources → CMT Fusion Platform → Risk Scores' },
    { layout: 'two-cols', title: 'Pricing Accuracy|Claims Impact', body: 'Dynamic risk scoring per driver|Real-time FNOL alerts within minutes\nUsage-based mileage verification|Objective liability validation\nBehavioral segmentation|Subrogation support with trip-level evidence' },
    { layout: 'statement', title: 'The future of commercial auto is connected, scored, and priced per driver.' },
    { title: 'The Road Ahead', body: 'Where we go from here', layout: 'section-blue' },
    { title: 'Platform Impact|Key Capabilities', body: 'Streamlined digital consent workflow\n70+ TSP integrations\n90% market coverage by 2026\nReal-time risk selection at point of quote', layout: 'split' },
    { layout: 'custom', elements: [
      { type: 'text', content: '9.5%', x: 80, y: 60, w: 400, h: 140, fontSize: 84, color: '#1a80d7', bold: true, align: 'center' },
      { type: 'shape', shape: 'rect', x: 240, y: 210, w: 80, h: 3, fill: '#1a80d7' },
      { type: 'text', content: 'Potential loss ratio improvement from telematics adoption.', x: 80, y: 230, w: 400, h: 200, fontSize: 18, align: 'center' },
      { type: 'image', description: 'Before/after loss ratio waterfall chart', x: 520, y: 60, w: 380, h: 380 }
    ]},
    { layout: 'custom', elements: [
      { type: 'text', content: 'Data Flow Architecture', x: 48, y: 30, w: 860, h: 42, fontSize: 28, color: '#1a80d7', bold: true },
      { type: 'image', description: 'CMT data flow architecture: TSP Sources → CMT Fusion Platform → Risk Scores, Driver Coaching, Insurer Portal, Fleet Dashboard', x: 80, y: 90, w: 800, h: 380 }
    ]}
  ], { transition: 'FADE', transitionDuration: 0.4 });
  Logger.log(url);
}

// ═══════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════

function buildPresentation(title, slides, deckConfig) {
  // Merge deck config into theme
  deckConfig = deckConfig || {};
  T = {};
  for (var k in DEFAULT_THEME) T[k] = DEFAULT_THEME[k];
  if (deckConfig.accentColor) {
    T.accentColor = deckConfig.accentColor;
  }
  if (deckConfig.font) T.font = deckConfig.font;
  if (deckConfig.titleSize) T.titleSize = deckConfig.titleSize;
  if (deckConfig.bodySize) T.bodySize = deckConfig.bodySize;
  if (deckConfig.bodyColor) T.bodyColor = deckConfig.bodyColor;

  var defaultTransition = deckConfig.transition || null;
  var defaultTransitionDuration = deckConfig.transitionDuration || 0.3;

  var pres = SlidesApp.create(title);
  var defaultSlides = pres.getSlides();
  if (defaultSlides.length > 0) defaultSlides[0].remove();

  for (var i = 0; i < slides.length; i++) {
    var s = slides[i];
    var slideTitle = s.title || '';
    var slideBody = s.body || '';
    var layout = (s.layout || '').toLowerCase().replace(/-/g, '');

    var slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill(T.white);

    switch (layout) {
      // Structured layouts
      case 'metrics':     buildMetrics(slide, slideTitle, slideBody); break;
      case 'comparison':  buildComparison(slide, slideTitle, slideBody); break;
      case 'table':       buildTable(slide, slideTitle, slideBody); break;
      case 'sectionblue': buildSectionBlue(slide, slideTitle, slideBody); break;
      case 'split':       buildSplit(slide, slideTitle, slideBody); break;
      // Slot-based layouts
      case 'fact':        buildFact(slide, slideTitle, slideBody); break;
      case 'twocols':     buildTwoCols(slide, slideTitle, slideBody); break;
      case 'imageleft':   buildImageSide(slide, slideTitle, slideBody, s.image || '', 'left'); break;
      case 'imageright':  buildImageSide(slide, slideTitle, slideBody, s.image || '', 'right'); break;
      // Freeform
      case 'custom':      buildCustom(slide, s.elements || []); break;
      default:            buildCustom(slide, s.elements || []); break;
    }

    // Speaker notes
    if (s.notes) {
      var notesPage = slide.getNotesPage();
      var notesShape = notesPage.getPlaceholder(SlidesApp.PlaceholderType.BODY);
      if (notesShape) {
        notesShape.getText().setText(s.notes);
        notesShape.getText().getTextStyle().setFontFamily(T.font);
        notesShape.getText().getTextStyle().setFontSize(12);
      }
    }

    // Footer — conditional: skip on section-blue (full-bleed)
    if (layout !== 'sectionblue') {
      addFooter(slide);
    }

    // Transitions
    var transType = s.transition || defaultTransition;
    var transDur = s.transitionDuration || defaultTransitionDuration;
    if (transType) {
      applyTransition(slide, transType, transDur);
    }
  }

  pres.saveAndClose();

  // Share presentation with anyone who has the link (editor access)
  var file = DriveApp.getFileById(pres.getId());
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);

  return pres.getUrl();
}

// ═══════════════════════════════════════════════════════════════
// TRANSITIONS
// ═══════════════════════════════════════════════════════════════

function applyTransition(slide, type, duration) {
  var transEnum = null;
  var upper = type.toUpperCase().replace(/[_-]/g, '');
  switch (upper) {
    case 'FADE':           transEnum = SlidesApp.SlideTransitionType.FADE; break;
    case 'SLIDELEFT':
    case 'SLIDEFROMLEFT':  transEnum = SlidesApp.SlideTransitionType.SLIDE_FROM_LEFT; break;
    case 'SLIDERIGHT':
    case 'SLIDEFROMRIGHT': transEnum = SlidesApp.SlideTransitionType.SLIDE_FROM_RIGHT; break;
    case 'FLIP':           transEnum = SlidesApp.SlideTransitionType.FLIP; break;
    case 'CUBE':           transEnum = SlidesApp.SlideTransitionType.CUBE; break;
    case 'GALLERY':        transEnum = SlidesApp.SlideTransitionType.GALLERY; break;
    case 'DISSOLVE':       transEnum = SlidesApp.SlideTransitionType.DISSOLVE; break;
    case 'NONE':           transEnum = SlidesApp.SlideTransitionType.NONE; break;
    default:               transEnum = SlidesApp.SlideTransitionType.FADE; break;
  }
  if (transEnum !== null) {
    slide.getSlideTransition().setTransitionType(transEnum);
    slide.getSlideTransition().setDuration(duration || 0.3);
  }
}

// ═══════════════════════════════════════════════════════════════
// CUSTOM — freeform element placement
// ═══════════════════════════════════════════════════════════════

function buildCustom(slide, elements) {
  if (!elements || elements.length === 0) return;

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var x = el.x || 0;
    var y = el.y || 0;
    var w = el.w || 200;
    var h = el.h || 40;

    if (el.type === 'text') {
      var content = (el.content || '').replace(/^- /gm, '\u2022  ');
      var tBox = slide.insertTextBox(content, x, y, w, h);
      var style = tBox.getText().getTextStyle();
      style.setFontFamily(T.font);
      style.setFontSize(el.fontSize || T.bodySize);
      style.setForegroundColor(el.color || T.bodyColor);
      style.setBold(!!el.bold);
      if (el.italic) style.setItalic(true);

      var pStyle = tBox.getText().getParagraphStyle();
      if (el.align === 'center') pStyle.setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
      else if (el.align === 'right') pStyle.setParagraphAlignment(SlidesApp.ParagraphAlignment.END);
      if (el.lineSpacing) pStyle.setLineSpacing(el.lineSpacing);

      // Support rich text: bold ranges via **text** markers
      applyBoldMarkers(tBox.getText());

    } else if (el.type === 'shape') {
      var shapeType = SlidesApp.ShapeType.RECTANGLE;
      if (el.shape === 'ellipse' || el.shape === 'circle') shapeType = SlidesApp.ShapeType.ELLIPSE;
      var shape = slide.insertShape(shapeType, x, y, w, h);
      shape.getBorder().setTransparent();
      if (el.fill) {
        shape.getFill().setSolidFill(el.fill);
      } else {
        shape.getFill().setSolidFill(T.lightBg);
      }
      if (el.content) {
        var sText = shape.getText();
        sText.setText(el.content);
        var sStyle = sText.getTextStyle();
        sStyle.setFontFamily(T.font);
        sStyle.setFontSize(el.fontSize || 14);
        sStyle.setForegroundColor(el.color || T.white);
        sStyle.setBold(!!el.bold);
        sText.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
        shape.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
      }

    } else if (el.type === 'image') {
      buildImagePlaceholder(slide, x, y, w, h, el.description || el.content || '');

    } else if (el.type === 'chart') {
      // Charts render live in the browser via Chart.js but can't be recreated natively in Apps Script.
      // Export as a labeled placeholder describing the chart.
      var chartConfig = el.chart || {};
      var chartType = (chartConfig.type || 'chart').toUpperCase();
      var chartLabels = (chartConfig.data && chartConfig.data.labels) ? chartConfig.data.labels.join(', ') : '';
      var desc = chartType + ' chart';
      if (chartLabels) desc += ': ' + chartLabels;
      buildImagePlaceholder(slide, x, y, w, h, desc);
    }
  }
}


// ═══════════════════════════════════════════════════════════════
// FACT — single hero stat centered
// Title = the big number, Body = context
// ═══════════════════════════════════════════════════════════════

function buildFact(slide, title, body) {
  // Decorative watermark
  var wmBox = slide.insertTextBox(title, -40, 40, 600, 280);
  styleText(wmBox, 160, T.accentVeryLight, true);
  wmBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  // Hero number
  var hBox = slide.insertTextBox(title, 80, 100, 800, 160);
  styleText(hBox, 84, T.accentColor, true);
  hBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  // Accent line
  var line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 420, 275, 120, 3);
  line.getBorder().setTransparent();
  line.getFill().setSolidFill(T.accentColor);

  // Context
  if (body) {
    var bBox = slide.insertTextBox(body, 140, 300, 680, 140);
    styleText(bBox, 20, T.darkAccent, false);
    bBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    bBox.getText().getParagraphStyle().setLineSpacing(150);
  }
}

// ═══════════════════════════════════════════════════════════════
// QUOTE — styled pull quote with attribution
// Body = quote text, Title = attribution
// ═══════════════════════════════════════════════════════════════

function buildQuote(slide, attribution, body) {
  // Vertical accent bar
  var bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 64, 80, 4, 300);
  bar.getBorder().setTransparent();
  bar.getFill().setSolidFill(T.accentColor);

  // Decorative open quote
  var qMark = slide.insertTextBox('\u201c', 88, 55, 80, 100);
  styleText(qMark, 80, T.accentVeryLight, true);

  // Quote text
  var qBox = slide.insertTextBox(body, 100, 120, 760, 220);
  styleText(qBox, 26, T.bodyColor, false);
  qBox.getText().getTextStyle().setItalic(true);
  qBox.getText().getParagraphStyle().setLineSpacing(170);

  // Separator
  var sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 100, 355, 120, 1);
  sep.getBorder().setTransparent();
  sep.getFill().setSolidFill(T.midGray);

  // Attribution
  if (attribution) {
    var aBox = slide.insertTextBox('\u2014  ' + attribution, 100, 370, 760, 40);
    styleText(aBox, 16, T.subtleColor, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// STATEMENT — single bold sentence, centered
// Title = the statement, Body = optional subtitle
// ═══════════════════════════════════════════════════════════════

function buildStatement(slide, title, body) {
  // Accent line above
  var line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 340, 140, 280, 3);
  line.getBorder().setTransparent();
  line.getFill().setSolidFill(T.accentColor);

  // Statement
  var sBox = slide.insertTextBox(title, 80, 165, 800, 180);
  styleText(sBox, 32, T.bodyColor, true);
  sBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  sBox.getText().getParagraphStyle().setLineSpacing(150);

  // Accent line below
  var line2 = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 340, 360, 280, 3);
  line2.getBorder().setTransparent();
  line2.getFill().setSolidFill(T.accentColor);

  // Optional subtitle
  if (body) {
    var bBox = slide.insertTextBox(body, 140, 380, 680, 80);
    styleText(bBox, 18, T.subtleColor, false);
    bBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    bBox.getText().getParagraphStyle().setLineSpacing(140);
  }
}

// ═══════════════════════════════════════════════════════════════
// TWO-COLS — two equal content columns
// Title: "Left Header|Right Header", Body: "left|right" per line
// ═══════════════════════════════════════════════════════════════

function buildTwoCols(slide, title, body) {
  var titles = title.split('|');
  var leftTitle = (titles[0] || '').trim();
  var rightTitle = (titles[1] || '').trim();

  // Left header
  var ltBox = slide.insertTextBox(leftTitle, 48, 30, 416, 42);
  styleText(ltBox, 22, T.accentColor, true);

  // Right header
  var rtBox = slide.insertTextBox(rightTitle, 496, 30, 416, 42);
  styleText(rtBox, 22, T.accentColor, true);

  // Vertical divider
  var divider = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 478, 30, 2, 440);
  divider.getBorder().setTransparent();
  divider.getFill().setSolidFill(T.midGray);

  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var availH = 390;
  var startY = 84;
  var itemH = Math.min(70, availH / lines.length);

  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split('|');
    var y = startY + i * itemH;
    var leftText = (parts[0] || '').trim().replace(/^[-•]\s*/, '');
    var rightText = (parts.length > 1 ? parts[1] : '').trim().replace(/^[-•]\s*/, '');

    var fontSize = lines.length > 5 ? 13 : 15;

    // Left bullet
    var lDot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, 48, y + 8, 6, 6);
    lDot.getBorder().setTransparent();
    lDot.getFill().setSolidFill(T.accentColor);
    var lBox = slide.insertTextBox(leftText, 64, y, 400, itemH);
    styleText(lBox, fontSize, T.bodyColor, false);
    lBox.getText().getParagraphStyle().setLineSpacing(fontSize <= 13 ? 120 : 135);

    // Right bullet
    if (rightText) {
      var rDot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, 496, y + 8, 6, 6);
      rDot.getBorder().setTransparent();
      rDot.getFill().setSolidFill(T.accentColor);
      var rBox = slide.insertTextBox(rightText, 512, y, 400, itemH);
      styleText(rBox, fontSize, T.bodyColor, false);
      rBox.getText().getParagraphStyle().setLineSpacing(fontSize <= 13 ? 120 : 135);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// IMAGE-LEFT / IMAGE-RIGHT — image on one side, text on the other
// Title = slide title, Body = bullet content, image field = description
// ═══════════════════════════════════════════════════════════════

function buildImageSide(slide, title, body, imageDesc, side) {
  var imgX, imgY, imgW, imgH, textX, textW;
  if (side === 'left') {
    imgX = 40; imgY = 30; imgW = 400; imgH = 440;
    textX = 472; textW = 440;
  } else {
    imgX = 520; imgY = 30; imgW = 400; imgH = 440;
    textX = 48; textW = 440;
  }

  // Image placeholder
  buildImagePlaceholder(slide, imgX, imgY, imgW, imgH, imageDesc);

  // Title
  var tBox = slide.insertTextBox(title, textX, 30, textW, 50);
  styleText(tBox, T.titleSize, T.accentColor, true);

  // Body content
  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var startY = 96;
  var availH = 370;
  var itemH = Math.min(65, availH / lines.length);
  var fontSize = lines.length > 5 ? 13 : 15;

  for (var i = 0; i < lines.length; i++) {
    var text = lines[i].trim().replace(/^[-•]\s*/, '');
    var y = startY + i * itemH;

    var accent = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, textX, y + 4, 3, itemH - 12);
    accent.getBorder().setTransparent();
    accent.getFill().setSolidFill(T.accentColor);

    var iBox = slide.insertTextBox(text, textX + 14, y + 4, textW - 14, itemH - 8);
    styleText(iBox, fontSize, T.bodyColor, false);
    iBox.getText().getParagraphStyle().setLineSpacing(fontSize <= 13 ? 120 : 140);
    applyBoldMarkers(iBox.getText());
  }
}

// ═══════════════════════════════════════════════════════════════
// METRICS — big numbers in auto-grid
// ═══════════════════════════════════════════════════════════════

function buildMetrics(slide, title, body) {
  var tBox = slide.insertTextBox(title, 48, 30, 860, 42);
  styleText(tBox, T.titleSize, T.accentColor, true);

  var items = body.split('\n').filter(function(l) { return l.trim(); });
  var cols = items.length <= 3 ? items.length : (items.length <= 4 ? 2 : 3);
  var rows = Math.ceil(items.length / cols);
  var cellW = 860 / cols;
  var availH = 450;
  var cellH = Math.min(200, availH / rows);

  for (var i = 0; i < items.length; i++) {
    var parts = items[i].split('|');
    var metric = parts[0].trim();
    var label = parts.length > 1 ? parts[1].trim() : '';
    var col = i % cols;
    var row = Math.floor(i / cols);
    var x = 48 + col * cellW;
    var y = 84 + row * cellH;

    var metricFontSize = cols <= 2 ? 48 : 40;
    var metricH = cols <= 2 ? 64 : 56;
    var mBox = slide.insertTextBox(metric, x, y, cellW - 16, metricH);
    styleText(mBox, metricFontSize, T.accentColor, true);

    var accentLine = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x + 4, y + metricH + 2, Math.min(60, cellW / 3), 2);
    accentLine.getBorder().setTransparent();
    accentLine.getFill().setSolidFill(T.midGray);

    if (label) {
      var labelH = cellH - metricH - 16;
      var labelFont = autoFitFontSize(label, cellW - 16, labelH, T.bodySize, 10);
      var lBox = slide.insertTextBox(label, x, y + metricH + 10, cellW - 16, labelH);
      styleText(lBox, labelFont, T.bodyColor, false);
      lBox.getText().getParagraphStyle().setLineSpacing(labelFont <= 11 ? 115 : 130);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPARISON — before/after with colored headers
// ═══════════════════════════════════════════════════════════════

function buildComparison(slide, title, body) {
  var titles = title.split('|');
  var leftTitle = titles[0].trim();
  var rightTitle = titles.length > 1 ? titles[1].trim() : '';

  var lBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 48, 30, 416, 42);
  lBar.getBorder().setTransparent();
  lBar.getFill().setSolidFill(T.lightBg);
  var ltBox = slide.insertTextBox(leftTitle, 60, 34, 392, 34);
  styleText(ltBox, 20, T.bodyColor, true);

  var rBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 496, 30, 416, 42);
  rBar.getBorder().setTransparent();
  rBar.getFill().setSolidFill(T.accentColor);
  var rtBox = slide.insertTextBox(rightTitle, 508, 34, 392, 34);
  styleText(rtBox, 20, T.white, true);

  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var availH = 440;
  var rowH = Math.min(80, availH / lines.length);

  var maxCellLen = 0;
  for (var j = 0; j < lines.length; j++) {
    var pp = lines[j].split('|');
    for (var k = 0; k < pp.length; k++) {
      maxCellLen = Math.max(maxCellLen, pp[k].trim().length);
    }
  }
  var baseFontSize = 15;
  if (maxCellLen > 60 || lines.length > 5) baseFontSize = 13;
  if (maxCellLen > 80 || lines.length > 7) baseFontSize = 11;
  var cellFontSize = Math.max(10, Math.min(baseFontSize, Math.floor(rowH / 2.5)));

  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split('|');
    var y = 84 + i * rowH;

    if (i > 0) {
      var sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 48, y - 2, 864, 1);
      sep.getBorder().setTransparent();
      sep.getFill().setSolidFill(T.lightBg);
    }

    var lBox = slide.insertTextBox(parts[0].trim(), 48, y + 4, 416, rowH - 8);
    styleText(lBox, cellFontSize, T.subtleColor, false);
    lBox.getText().getParagraphStyle().setLineSpacing(cellFontSize <= 12 ? 120 : 130);

    if (parts.length > 1) {
      var rBox = slide.insertTextBox(parts[1].trim(), 496, y + 4, 416, rowH - 8);
      styleText(rBox, cellFontSize, T.bodyColor, false);
      rBox.getText().getParagraphStyle().setLineSpacing(cellFontSize <= 12 ? 120 : 130);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// TABLE — data table with header row
// ═══════════════════════════════════════════════════════════════

function buildTable(slide, title, body) {
  var headers = title.split('|');
  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var cols = headers.length;
  var rows = lines.length;
  var tableW = 864;
  var colW = tableW / cols;
  var headerH = 40;
  var rowH = Math.min(56, 410 / rows);
  var startX = 48;
  var startY = 48;

  var hBg = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, startX, startY, tableW, headerH);
  hBg.getBorder().setTransparent();
  hBg.getFill().setSolidFill(T.accentColor);

  for (var c = 0; c < cols; c++) {
    var hBox = slide.insertTextBox(headers[c].trim(), startX + c * colW + 8, startY + 6, colW - 16, headerH - 12);
    styleText(hBox, 14, T.white, true);
  }

  for (var r = 0; r < rows; r++) {
    var parts = lines[r].split('|');
    var y = startY + headerH + r * rowH;

    if (r % 2 === 0) {
      var rBg = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, startX, y, tableW, rowH);
      rBg.getBorder().setTransparent();
      rBg.getFill().setSolidFill(T.lightBg);
    }

    var border = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, startX, y + rowH - 1, tableW, 1);
    border.getBorder().setTransparent();
    border.getFill().setSolidFill(T.midGray);

    for (var c = 0; c < cols; c++) {
      var cellText = (parts[c] || '').trim();
      var cBox = slide.insertTextBox(cellText, startX + c * colW + 8, y + 6, colW - 16, rowH - 12);
      styleText(cBox, 14, T.bodyColor, false);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION-BLUE — gradient blue divider
// ═══════════════════════════════════════════════════════════════

function buildSectionBlue(slide, title, body) {
  var gradientColors = [T.accentDark, T.accentMid, T.accentColor, T.accentLight];
  var stripW = 240;
  for (var g = 0; g < gradientColors.length; g++) {
    var strip = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, g * stripW, 0, stripW + 1, 540);
    strip.getBorder().setTransparent();
    strip.getFill().setSolidFill(gradientColors[g]);
  }

  var tBox = slide.insertTextBox(title, 64, 130, 830, 100);
  styleText(tBox, 38, T.white, true);
  tBox.getText().getParagraphStyle().setLineSpacing(130);

  var line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 64, 240, 60, 3);
  line.getBorder().setTransparent();
  line.getFill().setSolidFill(T.white);

  if (body) {
    var bBox = slide.insertTextBox(body, 64, 260, 830, 160);
    styleText(bBox, 20, T.white, false);
    bBox.getText().getTextStyle().setForegroundColor(T.accentVeryLight);
    bBox.getText().getParagraphStyle().setLineSpacing(150);
  }
}

// ═══════════════════════════════════════════════════════════════
// SPLIT — left gradient hero + right white details
// ═══════════════════════════════════════════════════════════════

function buildSplit(slide, title, body) {
  var titles = title.split('|');
  var leftTitle = (titles[0] || '').trim();
  var rightTitle = (titles[1] || '').trim();

  var panelColors = [T.accentDark, T.accentMid, T.accentColor];
  var panelStripH = 180;
  for (var g = 0; g < panelColors.length; g++) {
    var strip = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, g * panelStripH, 380, panelStripH + 1);
    strip.getBorder().setTransparent();
    strip.getFill().setSolidFill(panelColors[g]);
  }

  var hBox = slide.insertTextBox(leftTitle, 40, 160, 300, 200);
  styleText(hBox, 26, T.white, true);
  hBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  hBox.getText().getParagraphStyle().setLineSpacing(130);

  var divider = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 170, 370, 40, 3);
  divider.getBorder().setTransparent();
  divider.getFill().setSolidFill(T.white);

  if (rightTitle) {
    var rtBox = slide.insertTextBox(rightTitle, 412, 38, 500, 36);
    styleText(rtBox, 20, T.accentColor, true);
  }

  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var availH = rightTitle ? 380 : 420;
  var startY = rightTitle ? 90 : 60;
  var itemH = Math.min(56, availH / lines.length);

  var maxItemLen = 0;
  for (var j = 0; j < lines.length; j++) {
    maxItemLen = Math.max(maxItemLen, lines[j].trim().length);
  }
  var itemFont = 15;
  if (maxItemLen > 60 || lines.length > 5) itemFont = 13;
  if (maxItemLen > 80 || lines.length > 7) itemFont = 11;

  for (var i = 0; i < lines.length; i++) {
    var text = lines[i].trim().replace(/^[-•]\s*/, '');
    var y = startY + i * itemH;

    var accent = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 412, y + 4, 3, itemH - 12);
    accent.getBorder().setTransparent();
    accent.getFill().setSolidFill(T.accentColor);

    var iBox = slide.insertTextBox(text, 424, y + 4, 480, itemH - 8);
    styleText(iBox, itemFont, T.bodyColor, false);
    iBox.getText().getParagraphStyle().setLineSpacing(itemFont <= 12 ? 120 : 140);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function styleText(textBox, fontSize, color, bold) {
  var style = textBox.getText().getTextStyle();
  style.setFontSize(fontSize);
  style.setForegroundColor(color);
  style.setBold(bold);
  style.setFontFamily(T.font);
}

function autoFitFontSize(text, boxWidth, boxHeight, maxSize, minSize) {
  minSize = minSize || 10;
  var size = maxSize;
  while (size > minSize) {
    var charsPerLine = Math.floor(boxWidth / (size * 0.55));
    if (charsPerLine < 1) charsPerLine = 1;
    var lines = text.split('\n');
    var totalLines = 0;
    for (var i = 0; i < lines.length; i++) {
      totalLines += Math.max(1, Math.ceil(lines[i].length / charsPerLine));
    }
    var lineHeight = size * 1.5;
    if (totalLines * lineHeight <= boxHeight) return size;
    size--;
  }
  return minSize;
}

function applyBoldMarkers(textObj) {
  var raw = textObj.asString();
  var boldPattern = /\*\*(.+?)\*\*/g;
  var match;
  var replacements = [];
  while ((match = boldPattern.exec(raw)) !== null) {
    replacements.push({ start: match.index, end: match.index + match[0].length, inner: match[1] });
  }
  for (var r = replacements.length - 1; r >= 0; r--) {
    var rep = replacements[r];
    var currentText = textObj.asString();
    var before = currentText.substring(0, rep.start);
    var after = currentText.substring(rep.end);
    textObj.setText(before + rep.inner + after);
    textObj.getRange(rep.start, rep.start + rep.inner.length).getTextStyle().setBold(true);
  }
}

function buildImagePlaceholder(slide, x, y, w, h, description) {
  var box = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
  box.getBorder().setWeight(2);
  box.getBorder().setDashStyle(SlidesApp.DashStyle.DASH);
  box.getBorder().getLineFill().setSolidFill(T.subtleColor);
  box.getFill().setSolidFill(T.midGray);

  var label = 'TBD\n' + (description || 'Image needed');
  var tBox = slide.insertTextBox(label, x + 16, y + Math.max(10, (h - 60) / 2), w - 32, 60);
  var style = tBox.getText().getTextStyle();
  style.setFontSize(14);
  style.setForegroundColor('#6B7280');
  style.setFontFamily(T.font);
  tBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  var text = tBox.getText();
  var tbdRange = text.getRange(0, 3);
  tbdRange.getTextStyle().setBold(true);
  tbdRange.getTextStyle().setFontSize(18);
}

function addFooter(slide) {
  // Google Slides canvas: 720 x 405 points (10" x 5.625" at 72 DPI)
  // Footer zone: bottom 28 points
  var PW = 720;
  var PH = 405;

  var lineY = PH - 28;
  var textY = PH - 22;
  var logoSize = 16;
  var logoX = PW - 20 - logoSize;
  var logoY = PH - 22;

  // Separator line
  var footerLine = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 20, lineY, PW - 40, 1);
  footerLine.getBorder().setTransparent();
  footerLine.getFill().setSolidFill(T.midGray);

  // Footer text
  var textBox = slide.insertTextBox('Confidential & Proprietary | Cambridge Mobile Telematics', 20, textY, 320, 18);
  var textStyle = textBox.getText().getTextStyle();
  textStyle.setFontSize(6);
  textStyle.setForegroundColor('#CBCBCB');
  textStyle.setBold(false);
  textStyle.setFontFamily(T.font);

  // CMT logo (right side)
  var FOOTER_LOGO_ID = '1GQOl7NSsMV5R5MYqn9OmHDxdd_W_vMO5';
  try {
    var logoFile = DriveApp.getFileById(FOOTER_LOGO_ID);
    var logoBlob = logoFile.getBlob();
    slide.insertImage(logoBlob, logoX, logoY, logoSize, logoSize);
  } catch (e) {
    // Fallback: gray circle placeholder
    var logoCircle = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, logoX, logoY, logoSize, logoSize);
    logoCircle.getBorder().setWeight(1);
    logoCircle.getBorder().getLineFill().setSolidFill('#CBCBCB');
    logoCircle.getFill().setTransparent();
  }
}
