const express = require("express");
const PDFDocument = require("pdfkit");
const { getFontPath } = require("@noto-pdf-ts/fonts-jp");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const vocabulary = require("./data/system-english.json");
const FONT_PATH = getFontPath();

console.log(`問題データ読込完了: ${vocabulary.length}問`);
console.log(`日本語フォント: ${FONT_PATH}`);

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function selectQuestions(start, end, count, order) {
  let candidates = vocabulary.filter(item => item.no >= start && item.no <= end);
  if (count > candidates.length) throw new Error("出題数が指定範囲の問題数を超えています。");
  return order === "random" ? shuffle(candidates).slice(0, count) : candidates.slice(0, count);
}

function useJP(doc) { doc.font(FONT_PATH); }

function addCover(doc, isAnswer, settings) {
  useJP(doc);
  doc.fontSize(14).text("武田塾 武蔵境校", { align: "center" });
  doc.moveDown(3);
  doc.fontSize(30).text(isAnswer ? "模範解答" : "確認テスト", { align: "center" });
  if (isAnswer) {
    doc.moveDown(1.2);
    doc.fontSize(15).text("講師用", { align: "center" });
  }
  doc.moveDown(5);
  doc.fontSize(13).text("参考書：システム英単語");
  doc.moveDown(0.8).text(`範囲：No.${settings.start} ～ No.${settings.end}`);
  doc.moveDown(0.8).text(`問題数：${settings.count}問`);
}

function addQuestionPages(doc, questions, isAnswer) {
  doc.addPage();
  useJP(doc);
  questions.forEach((item, index) => {
    if (doc.y > (isAnswer ? 735 : 720)) {
      doc.addPage();
      useJP(doc);
    }
    doc.fontSize(11).text(`${index + 1}.  ${item.word}`, { width: 500 });
    if (isAnswer) {
      doc.moveDown(0.3);
      doc.fontSize(10).text(`模範解答：${item.answer}`, { width: 500 });
      doc.moveDown(0.8);
    } else {
      doc.moveDown(0.5);
      const y = doc.y;
      doc.moveTo(58, y).lineTo(545, y).lineWidth(0.5).stroke();
      doc.moveDown(1.2);
    }
  });
}

function addAnswerFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    useJP(doc);
    doc.fontSize(8).text("模範解答・講師用", 45, 810, { align: "right", width: 500, lineBreak: false });
  }
}

function createPDF(res, questions, type, settings) {
  const isAnswer = type === "answer";
  const doc = new PDFDocument({ size: "A4", margin: 45, bufferPages: true, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${isAnswer ? "answer" : "test"}_${settings.start}-${settings.end}_${settings.count}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  doc.pipe(res);
  addCover(doc, isAnswer, settings);
  addQuestionPages(doc, questions, isAnswer);
  if (isAnswer) addAnswerFooters(doc);
  doc.end();
}

app.get("/health", (req, res) => res.json({ status: "ok", questions: vocabulary.length, japaneseFont: true, fontPath: FONT_PATH }));

app.get("/generate", (req, res) => {
  try {
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    const count = Number(req.query.count);
    const order = req.query.order || "random";
    const type = req.query.type || "test";
    if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(count)) return res.status(400).send("入力値が正しくありません。");
    if (start < 1 || end > 2027 || start > end) return res.status(400).send("出題範囲が正しくありません。");
    if (count < 1 || count > 100) return res.status(400).send("出題数は1〜100問で指定してください。");
    if (type !== "test" && type !== "answer") return res.status(400).send("出力形式が正しくありません。");
    const questions = selectQuestions(start, end, count, order);
    createPDF(res, questions, type, { start, end, count });
  } catch (error) {
    console.error("生成エラー:", error);
    if (!res.headersSent) res.status(500).send(`PDF生成エラー: ${error.message}`);
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`確認テストサーバー起動: port ${PORT}`));
