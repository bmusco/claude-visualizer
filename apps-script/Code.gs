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

// Google Slides canvas: 720 x 405 points (10" x 5.625" at 72 DPI)
// All layout coordinates must fit within this.
var L = {
  PW: 720,          // page width
  PH: 405,          // page height
  M: 36,            // margin left/right
  CW: 648,          // content width (720 - 2*36)
  TY: 22,           // title Y
  TH: 32,           // title height
  CY: 64,           // content start Y (below title)
  FZ: 28,           // footer zone height
  MAX_Y: 377,       // max content Y (405 - 28)
  AH: 313,          // available height for content (377 - 64)
};

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
      case 'quote':       buildQuote(slide, slideTitle, slideBody); break;
      case 'statement':   buildStatement(slide, slideTitle, slideBody); break;
      case 'twocols':     buildTwoCols(slide, slideTitle, slideBody); break;
      case 'imageleft':   buildImageSide(slide, slideTitle, slideBody, s.image || '', 'left'); break;
      case 'imageright':  buildImageSide(slide, slideTitle, slideBody, s.image || '', 'right'); break;
      // Freeform
      case 'custom':      buildCustom(slide, s.elements || []); break;
      default:
        // Default: if there are elements, render custom; otherwise build a title+body slide
        if (s.elements && s.elements.length > 0) {
          buildCustom(slide, s.elements);
        } else if (slideTitle || slideBody) {
          buildDefaultSlide(slide, slideTitle, slideBody);
        }
        break;
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

function buildDefaultSlide(slide, title, body) {
  // Simple title + bullet body for slides with no layout and no elements
  if (title) {
    var tBox = slide.insertTextBox(title, L.M, L.TY, L.CW, L.TH);
    styleText(tBox, T.titleSize, T.accentColor, true);
  }
  if (body) {
    var content = body.replace(/^- /gm, '\u2022  ');
    var bBox = slide.insertTextBox(content, L.M, L.CY, L.CW, L.AH);
    styleText(bBox, T.bodySize, T.bodyColor, false);
    bBox.getText().getParagraphStyle().setLineSpacing(150);
    applyBoldMarkers(bBox.getText());
  }
}

function buildCustom(slide, elements) {
  if (!elements || elements.length === 0) return;

  // Scale factor: CLAUDE.md tells Claude to use 960x540 canvas,
  // but Google Slides native is 720x405. Scale all coordinates.
  var SX = 720 / 960;  // 0.75
  var SY = 405 / 540;  // 0.75

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var x = (el.x || 0) * SX;
    var y = (el.y || 0) * SY;
    var w = (el.w || 200) * SX;
    var h = (el.h || 40) * SY;

    if (el.type === 'text') {
      var content = (el.content || '').replace(/^- /gm, '\u2022  ');
      var tBox = slide.insertTextBox(content, x, y, w, h);
      var style = tBox.getText().getTextStyle();
      style.setFontFamily(T.font);
      style.setFontSize(Math.round((el.fontSize || T.bodySize) * SX));
      style.setForegroundColor(normalizeHex(el.color || T.bodyColor));
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
        shape.getFill().setSolidFill(normalizeHex(el.fill));
      } else {
        shape.getFill().setSolidFill(T.lightBg);
      }
      if (el.content) {
        var sText = shape.getText();
        sText.setText(el.content);
        var sStyle = sText.getTextStyle();
        sStyle.setFontFamily(T.font);
        sStyle.setFontSize(Math.round((el.fontSize || 14) * SX));
        sStyle.setForegroundColor(normalizeHex(el.color || T.white));
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
  var wmBox = slide.insertTextBox(title, -30, 30, 450, 210);
  styleText(wmBox, 120, T.accentVeryLight, true);
  wmBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  // Hero number
  var hBox = slide.insertTextBox(title, 60, 75, 600, 120);
  styleText(hBox, 64, T.accentColor, true);
  hBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  // Accent line
  var line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 315, 205, 90, 3);
  line.getBorder().setTransparent();
  line.getFill().setSolidFill(T.accentColor);

  // Context
  if (body) {
    var bBox = slide.insertTextBox(body, 105, 225, 510, 120);
    styleText(bBox, 16, T.darkAccent, false);
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
  var bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 48, 60, 4, 225);
  bar.getBorder().setTransparent();
  bar.getFill().setSolidFill(T.accentColor);

  // Decorative open quote
  var qMark = slide.insertTextBox('\u201c', 66, 42, 60, 75);
  styleText(qMark, 60, T.accentVeryLight, true);

  // Quote text
  var qBox = slide.insertTextBox(body, 75, 90, 570, 165);
  styleText(qBox, 20, T.bodyColor, false);
  qBox.getText().getTextStyle().setItalic(true);
  qBox.getText().getParagraphStyle().setLineSpacing(170);

  // Separator
  var sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 75, 270, 90, 1);
  sep.getBorder().setTransparent();
  sep.getFill().setSolidFill(T.midGray);

  // Attribution
  if (attribution) {
    var aBox = slide.insertTextBox('\u2014  ' + attribution, 75, 280, 570, 30);
    styleText(aBox, 13, T.subtleColor, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// STATEMENT — single bold sentence, centered
// Title = the statement, Body = optional subtitle
// ═══════════════════════════════════════════════════════════════

function buildStatement(slide, title, body) {
  // Accent line above
  var line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 255, 105, 210, 3);
  line.getBorder().setTransparent();
  line.getFill().setSolidFill(T.accentColor);

  // Statement
  var sBox = slide.insertTextBox(title, 60, 120, 600, 135);
  styleText(sBox, 24, T.bodyColor, true);
  sBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  sBox.getText().getParagraphStyle().setLineSpacing(150);

  // Accent line below
  var line2 = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 255, 268, 210, 3);
  line2.getBorder().setTransparent();
  line2.getFill().setSolidFill(T.accentColor);

  // Optional subtitle
  if (body) {
    var bBox = slide.insertTextBox(body, 105, 280, 510, 60);
    styleText(bBox, 14, T.subtleColor, false);
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
  var colW = L.CW / 2;       // 324
  var rightX = L.M + colW + 12;

  // Left header
  var ltBox = slide.insertTextBox(leftTitle, L.M, L.TY, colW - 6, L.TH);
  styleText(ltBox, 18, T.accentColor, true);

  // Right header
  var rtBox = slide.insertTextBox(rightTitle, rightX, L.TY, colW - 6, L.TH);
  styleText(rtBox, 18, T.accentColor, true);

  // Vertical divider
  var divider = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, L.M + colW + 4, L.TY, 2, L.AH);
  divider.getBorder().setTransparent();
  divider.getFill().setSolidFill(T.midGray);

  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var itemH = Math.min(52, L.AH / lines.length);

  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split('|');
    var y = L.CY + i * itemH;
    var leftText = (parts[0] || '').trim().replace(/^[-•]\s*/, '');
    var rightText = (parts.length > 1 ? parts[1] : '').trim().replace(/^[-•]\s*/, '');

    var fontSize = lines.length > 5 ? 11 : 13;

    // Left bullet
    var lDot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, L.M, y + 6, 5, 5);
    lDot.getBorder().setTransparent();
    lDot.getFill().setSolidFill(T.accentColor);
    var lBox = slide.insertTextBox(leftText, L.M + 12, y, colW - 18, itemH);
    styleText(lBox, fontSize, T.bodyColor, false);
    lBox.getText().getParagraphStyle().setLineSpacing(fontSize <= 11 ? 115 : 130);

    // Right bullet
    if (rightText) {
      var rDot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, rightX, y + 6, 5, 5);
      rDot.getBorder().setTransparent();
      rDot.getFill().setSolidFill(T.accentColor);
      var rBox = slide.insertTextBox(rightText, rightX + 12, y, colW - 18, itemH);
      styleText(rBox, fontSize, T.bodyColor, false);
      rBox.getText().getParagraphStyle().setLineSpacing(fontSize <= 11 ? 115 : 130);
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
    imgX = L.M; imgY = L.TY; imgW = 300; imgH = L.AH;
    textX = L.M + 312; textW = L.CW - 312;
  } else {
    imgX = L.PW - L.M - 300; imgY = L.TY; imgW = 300; imgH = L.AH;
    textX = L.M; textW = L.CW - 312;
  }

  // Image placeholder
  buildImagePlaceholder(slide, imgX, imgY, imgW, imgH, imageDesc);

  // Title
  var tBox = slide.insertTextBox(title, textX, L.TY, textW, L.TH);
  styleText(tBox, T.titleSize, T.accentColor, true);

  // Body content
  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var itemH = Math.min(48, L.AH / lines.length);
  var fontSize = lines.length > 5 ? 11 : 13;

  for (var i = 0; i < lines.length; i++) {
    var text = lines[i].trim().replace(/^[-•]\s*/, '');
    var y = L.CY + i * itemH;

    var accent = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, textX, y + 3, 3, itemH - 8);
    accent.getBorder().setTransparent();
    accent.getFill().setSolidFill(T.accentColor);

    var iBox = slide.insertTextBox(text, textX + 12, y + 3, textW - 12, itemH - 6);
    styleText(iBox, fontSize, T.bodyColor, false);
    iBox.getText().getParagraphStyle().setLineSpacing(fontSize <= 11 ? 115 : 135);
    applyBoldMarkers(iBox.getText());
  }
}

// ═══════════════════════════════════════════════════════════════
// METRICS — big numbers in auto-grid
// ═══════════════════════════════════════════════════════════════

function buildMetrics(slide, title, body) {
  var tBox = slide.insertTextBox(title, L.M, L.TY, L.CW, L.TH);
  styleText(tBox, T.titleSize, T.accentColor, true);

  var items = body.split('\n').filter(function(l) { return l.trim(); });
  var cols = items.length <= 3 ? items.length : (items.length <= 4 ? 2 : 3);
  var rows = Math.ceil(items.length / cols);
  var cellW = L.CW / cols;
  var cellH = Math.min(150, L.AH / rows);

  for (var i = 0; i < items.length; i++) {
    var parts = items[i].split('|');
    var metric = parts[0].trim();
    var label = parts.length > 1 ? parts[1].trim() : '';
    var col = i % cols;
    var row = Math.floor(i / cols);
    var x = L.M + col * cellW;
    var y = L.CY + row * cellH;

    var metricFontSize = cols <= 2 ? 36 : 30;
    var metricH = cols <= 2 ? 48 : 42;
    var mBox = slide.insertTextBox(metric, x, y, cellW - 12, metricH);
    styleText(mBox, metricFontSize, T.accentColor, true);

    var accentLine = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x + 4, y + metricH + 2, Math.min(45, cellW / 3), 2);
    accentLine.getBorder().setTransparent();
    accentLine.getFill().setSolidFill(T.midGray);

    if (label) {
      var labelH = cellH - metricH - 12;
      var labelFont = autoFitFontSize(label, cellW - 12, labelH, 14, 9);
      var lBox = slide.insertTextBox(label, x, y + metricH + 8, cellW - 12, labelH);
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
  var colW = L.CW / 2;  // 324
  var rightX = L.M + colW + 6;

  var lBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, L.M, L.TY, colW - 3, L.TH);
  lBar.getBorder().setTransparent();
  lBar.getFill().setSolidFill(T.lightBg);
  var ltBox = slide.insertTextBox(leftTitle, L.M + 8, L.TY + 3, colW - 19, L.TH - 6);
  styleText(ltBox, 16, T.bodyColor, true);

  var rBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, rightX, L.TY, colW - 3, L.TH);
  rBar.getBorder().setTransparent();
  rBar.getFill().setSolidFill(T.accentColor);
  var rtBox = slide.insertTextBox(rightTitle, rightX + 8, L.TY + 3, colW - 19, L.TH - 6);
  styleText(rtBox, 16, T.white, true);

  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var rowH = Math.min(56, L.AH / lines.length);

  var maxCellLen = 0;
  for (var j = 0; j < lines.length; j++) {
    var pp = lines[j].split('|');
    for (var k = 0; k < pp.length; k++) {
      maxCellLen = Math.max(maxCellLen, pp[k].trim().length);
    }
  }
  var baseFontSize = 13;
  if (maxCellLen > 60 || lines.length > 5) baseFontSize = 11;
  if (maxCellLen > 80 || lines.length > 7) baseFontSize = 10;
  var cellFontSize = Math.max(9, Math.min(baseFontSize, Math.floor(rowH / 2.5)));

  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split('|');
    var y = L.CY + i * rowH;

    if (i > 0) {
      var sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, L.M, y - 2, L.CW, 1);
      sep.getBorder().setTransparent();
      sep.getFill().setSolidFill(T.lightBg);
    }

    var lBox = slide.insertTextBox(parts[0].trim(), L.M, y + 3, colW - 3, rowH - 6);
    styleText(lBox, cellFontSize, T.subtleColor, false);
    lBox.getText().getParagraphStyle().setLineSpacing(cellFontSize <= 11 ? 115 : 125);

    if (parts.length > 1) {
      var rBox = slide.insertTextBox(parts[1].trim(), rightX, y + 3, colW - 3, rowH - 6);
      styleText(rBox, cellFontSize, T.bodyColor, false);
      rBox.getText().getParagraphStyle().setLineSpacing(cellFontSize <= 11 ? 115 : 125);
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
  var tableW = L.CW;
  var colW = tableW / cols;
  var headerH = 30;
  var rowH = Math.min(42, (L.AH - headerH) / rows);
  var startX = L.M;
  var startY = L.TY + 8;

  var hBg = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, startX, startY, tableW, headerH);
  hBg.getBorder().setTransparent();
  hBg.getFill().setSolidFill(T.accentColor);

  for (var c = 0; c < cols; c++) {
    var hBox = slide.insertTextBox(headers[c].trim(), startX + c * colW + 6, startY + 5, colW - 12, headerH - 10);
    styleText(hBox, 12, T.white, true);
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
      var cBox = slide.insertTextBox(cellText, startX + c * colW + 6, y + 4, colW - 12, rowH - 8);
      styleText(cBox, 11, T.bodyColor, false);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION-BLUE — gradient blue divider
// ═══════════════════════════════════════════════════════════════

function buildSectionBlue(slide, title, body) {
  var gradientColors = [T.accentDark, T.accentMid, T.accentColor, T.accentLight];
  var stripW = L.PW / 4;
  for (var g = 0; g < gradientColors.length; g++) {
    var strip = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, g * stripW, 0, stripW + 1, L.PH);
    strip.getBorder().setTransparent();
    strip.getFill().setSolidFill(gradientColors[g]);
  }

  var tBox = slide.insertTextBox(title, 48, 100, 624, 75);
  styleText(tBox, 30, T.white, true);
  tBox.getText().getParagraphStyle().setLineSpacing(130);

  var line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 48, 182, 45, 3);
  line.getBorder().setTransparent();
  line.getFill().setSolidFill(T.white);

  if (body) {
    var bBox = slide.insertTextBox(body, 48, 195, 624, 120);
    styleText(bBox, 16, T.white, false);
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
  var leftW = 285;
  var rightX = leftW + 24;

  var panelColors = [T.accentDark, T.accentMid, T.accentColor];
  var panelStripH = L.PH / 3;
  for (var g = 0; g < panelColors.length; g++) {
    var strip = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, g * panelStripH, leftW, panelStripH + 1);
    strip.getBorder().setTransparent();
    strip.getFill().setSolidFill(panelColors[g]);
  }

  var hBox = slide.insertTextBox(leftTitle, 30, 120, 225, 150);
  styleText(hBox, 20, T.white, true);
  hBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  hBox.getText().getParagraphStyle().setLineSpacing(130);

  var divider = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 128, 278, 30, 3);
  divider.getBorder().setTransparent();
  divider.getFill().setSolidFill(T.white);

  if (rightTitle) {
    var rtBox = slide.insertTextBox(rightTitle, rightX, L.TY, L.PW - rightX - L.M, L.TH);
    styleText(rtBox, 16, T.accentColor, true);
  }

  var lines = body.split('\n').filter(function(l) { return l.trim(); });
  var startY = rightTitle ? L.CY : L.TY + 10;
  var availH = L.MAX_Y - startY;
  var itemH = Math.min(42, availH / lines.length);

  var maxItemLen = 0;
  for (var j = 0; j < lines.length; j++) {
    maxItemLen = Math.max(maxItemLen, lines[j].trim().length);
  }
  var itemFont = 13;
  if (maxItemLen > 60 || lines.length > 5) itemFont = 11;
  if (maxItemLen > 80 || lines.length > 7) itemFont = 10;

  for (var i = 0; i < lines.length; i++) {
    var text = lines[i].trim().replace(/^[-•]\s*/, '');
    var y = startY + i * itemH;

    var accent = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, rightX, y + 3, 3, itemH - 8);
    accent.getBorder().setTransparent();
    accent.getFill().setSolidFill(T.accentColor);

    var iBox = slide.insertTextBox(text, rightX + 12, y + 3, L.PW - rightX - L.M - 12, itemH - 6);
    styleText(iBox, itemFont, T.bodyColor, false);
    iBox.getText().getParagraphStyle().setLineSpacing(itemFont <= 11 ? 115 : 135);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

// Normalize shorthand hex (#fff → #ffffff, #abc → #aabbcc)
function normalizeHex(color) {
  if (!color || typeof color !== 'string') return color;
  color = color.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    var r = color[1], g = color[2], b = color[3];
    return '#' + r + r + g + g + b + b;
  }
  return color;
}

function styleText(textBox, fontSize, color, bold) {
  var style = textBox.getText().getTextStyle();
  style.setFontSize(fontSize);
  style.setForegroundColor(normalizeHex(color));
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
