const express = require("express");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const vocabulary = require("./data/system-english.json");

const FONT_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf";
let fontBytesPromise = null;

function getFontBytes() {
  if (!fontBytesPromise) {
    fontBytesPromise = fetch(FONT_URL).then(async response => {
      if (!response.ok) {
        throw new Error(`日本語フォント取得失敗: HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    });
  }
  return fontBytesPromise;
}

console.log(`問題データ読込完了: ${vocabulary.length}問`);

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function selectQuestions(start, end, count, order) {
  const candidates = vocabulary.filter(item => item.no >= start && item.no <= end);
  if (count > candidates.length) {
    throw new Error("出題数が指定範囲の問題数を超えています。");
  }
  return order === "random"
    ? shuffle(candidates).slice(0, count)
    : candidates.slice(0, count);
}

function centeredX(font, text, size, pageWidth) {
  return (pageWidth - font.widthOfTextAtSize(text, size)) / 2;
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  let current = "";
  for (const ch of String(text)) {
    const test = current + ch;
    if (current && font.widthOfTextAtSize(test, size) > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function buildPDF(questions, type, settings) {
  const isAnswer = type === "answer";
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await getFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 48;
  const TEXT_W = PAGE_W - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const school = "武田塾 武蔵境校";
  const title = isAnswer ? "模範解答" : "確認テスト";

  page.drawText(school, {
    x: centeredX(font, school, 14, PAGE_W),
    y: 760,
    size: 14,
    font
  });

  page.drawText(title, {
    x: centeredX(font, title, 30, PAGE_W),
    y: 645,
    size: 30,
    font
  });

  if (isAnswer) {
    const staff = "講師用";
    page.drawText(staff, {
      x: centeredX(font, staff, 15, PAGE_W),
      y: 605,
      size: 15,
      font
    });
  }

  page.drawText("参考書：システム英単語", { x: 70, y: 340, size: 13, font });
  page.drawText(`範囲：No.${settings.start} ～ No.${settings.end}`, { x: 70, y: 305, size: 13, font });
  page.drawText(`問題数：${settings.count}問`, { x: 70, y: 270, size: 13, font });

  page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 65;

  const newQuestionPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 65;
  };

  for (let i = 0; i < questions.length; i++) {
    const item = questions[i];
    const questionText = `${i + 1}.  ${item.word}`;
    const qLines = wrapText(questionText, font, 11, TEXT_W);
    const answerLines = isAnswer
      ? wrapText(`模範解答：${item.answer}`, font, 10, TEXT_W)
      : [];
    const needed = qLines.length * 17 + (isAnswer ? answerLines.length * 15 + 18 : 38);

    if (y - needed < 55) newQuestionPage();

    for (const line of qLines) {
      page.drawText(line, { x: MARGIN, y, size: 11, font });
      y -= 17;
    }

    if (isAnswer) {
      y -= 3;
      for (const line of answerLines) {
        page.drawText(line, { x: MARGIN + 12, y, size: 10, font });
        y -= 15;
      }
      y -= 15;
    } else {
      y -= 8;
      page.drawLine({
        start: { x: MARGIN + 8, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.5,
        color: rgb(0.35, 0.35, 0.35)
      });
      y -= 30;
    }
  }

  if (isAnswer) {
    const pages = pdfDoc.getPages();
    for (const p of pages) {
      const footer = "模範解答・講師用";
      const size = 8;
      p.drawText(footer, {
        x: PAGE_W - MARGIN - font.widthOfTextAtSize(footer, size),
        y: 28,
        size,
        font,
        color: rgb(0.4, 0.4, 0.4)
      });
    }
  }

  return Buffer.from(await pdfDoc.save());
}

app.get("/health", async (req, res) => {
  try {
    const bytes = await getFontBytes();
    res.json({
      status: "ok",
      questions: vocabulary.length,
      japaneseFont: true,
      fontType: "static-otf",
      fontBytes: bytes.length,
      pdfEngine: "pdf-lib"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/generate", async (req, res) => {
  try {
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    const count = Number(req.query.count);
    const order = req.query.order || "random";
    const type = req.query.type || "test";

    if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(count)) {
      return res.status(400).send("入力値が正しくありません。");
    }
    if (start < 1 || end > 2027 || start > end) {
      return res.status(400).send("出題範囲が正しくありません。");
    }
    if (count < 1 || count > 100) {
      return res.status(400).send("出題数は1〜100問で指定してください。");
    }
    if (type !== "test" && type !== "answer") {
      return res.status(400).send("出力形式が正しくありません。");
    }

    const questions = selectQuestions(start, end, count, order);
    const pdfBytes = await buildPDF(questions, type, { start, end, count });
    const isAnswer = type === "answer";
    const filename = `${isAnswer ? "answer" : "test"}_${start}-${end}_${count}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdfBytes.length));
    res.setHeader("Cache-Control", "no-store");
    res.end(pdfBytes);
  } catch (error) {
    console.error("PDF生成エラー:", error);
    res.status(500).send(`PDF生成エラー: ${error.message}`);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`確認テストサーバー起動: port ${PORT}`);
  getFontBytes()
    .then(bytes => console.log(`日本語Static OTF読込完了: ${bytes.length} bytes`))
    .catch(error => console.error("日本語フォント事前読込失敗:", error.message));
});
