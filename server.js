const express = require("express");
const PDFDocument = require("pdfkit");
const fs = require("fs");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

let vocabulary = [];

try {
  vocabulary = require("./data/system-english.json");
  console.log(`問題データ読込完了: ${vocabulary.length}問`);
} catch (error) {
  console.error("問題データの読み込みに失敗しました。", error);
}

const FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKjp-Regular.otf",
  "/usr/share/fonts/truetype/noto/NotoSansJP-Regular.ttf"
];

const FONT_PATH = FONT_CANDIDATES.find(path => fs.existsSync(path));

if (FONT_PATH) {
  console.log(`日本語フォント読込: ${FONT_PATH}`);
} else {
  console.warn("日本語フォントが見つかりません。Railwayのビルド設定を確認してください。");
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function selectQuestions(start, end, count, order) {
  let candidates = vocabulary.filter(
    item => item.no >= start && item.no <= end
  );

  if (count > candidates.length) {
    throw new Error("出題数が指定範囲の問題数を超えています。");
  }

  if (order === "random") {
    candidates = shuffle(candidates).slice(0, count);
  } else {
    candidates = candidates.slice(0, count);
  }

  return candidates;
}

function setJapaneseFont(doc) {
  if (!FONT_PATH) {
    throw new Error("日本語フォントがサーバーにインストールされていません。");
  }

  doc.registerFont("JP", FONT_PATH, "Noto Sans CJK JP");
  doc.font("JP");
}

function addCover(doc, isAnswer, settings) {
  setJapaneseFont(doc);

  doc
    .fontSize(14)
    .text("武田塾 武蔵境校", {
      align: "center"
    });

  doc.moveDown(3);

  doc
    .fontSize(30)
    .text(isAnswer ? "模範解答" : "確認テスト", {
      align: "center"
    });

  doc.moveDown(1.2);

  if (isAnswer) {
    doc
      .fontSize(15)
      .text("講師用", {
        align: "center"
      });
  }

  doc.moveDown(5);

  doc.fontSize(13);

  doc.text("参考書：システム英単語");
  doc.moveDown(0.8);
  doc.text(`範囲：No.${settings.start} ～ No.${settings.end}`);
  doc.moveDown(0.8);
  doc.text(`問題数：${settings.count}問`);
}

function addQuestionPages(doc, questions, isAnswer) {
  doc.addPage();
  setJapaneseFont(doc);

  questions.forEach((item, index) => {
    const answerHeight = isAnswer ? 44 : 54;

    if (doc.y > 780 - answerHeight) {
      doc.addPage();
      setJapaneseFont(doc);
    }

    doc.fontSize(11);

    doc.text(`${index + 1}.  ${item.word}`, {
      width: 500
    });

    if (isAnswer) {
      doc.moveDown(0.35);
      doc.fontSize(10).text(`模範解答：${item.answer}`, {
        width: 500
      });
      doc.moveDown(0.9);
    } else {
      doc.moveDown(0.55);
      doc
        .moveTo(58, doc.y)
        .lineTo(545, doc.y)
        .lineWidth(0.5)
        .stroke();
      doc.moveDown(1.25);
    }
  });
}

function addAnswerFooters(doc) {
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    setJapaneseFont(doc);
    doc
      .fontSize(8)
      .text("模範解答・講師用", 45, 810, {
        align: "right",
        width: 500,
        lineBreak: false
      });
  }
}

function createPDF(res, questions, type, settings) {
  const isAnswer = type === "answer";

  const doc = new PDFDocument({
    size: "A4",
    margin: 45,
    bufferPages: true,
    info: {
      Title: isAnswer ? "模範解答" : "確認テスト",
      Author: "武田塾 武蔵境校"
    }
  });

  const filename = isAnswer
    ? `answer_${settings.start}-${settings.end}_${settings.count}.pdf`
    : `test_${settings.start}-${settings.end}_${settings.count}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");

  doc.pipe(res);

  addCover(doc, isAnswer, settings);
  addQuestionPages(doc, questions, isAnswer);

  if (isAnswer) {
    addAnswerFooters(doc);
  }

  doc.end();
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    questions: vocabulary.length,
    japaneseFont: Boolean(FONT_PATH),
    fontPath: FONT_PATH || null
  });
});

app.get("/generate", (req, res) => {
  try {
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    const count = Number(req.query.count);
    const order = req.query.order || "random";
    const type = req.query.type || "test";

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !Number.isInteger(count)
    ) {
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
    createPDF(res, questions, type, { start, end, count });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).send(error.message);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`確認テストサーバー起動: port ${PORT}`);
});
