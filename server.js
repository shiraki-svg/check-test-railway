const express = require("express");
const PDFDocument = require("pdfkit");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// 後でシステム英単語2027語のデータをここから読み込む
let vocabulary = [];

try {
  vocabulary = require("./data/system-english.json");
  console.log(`問題データ読込完了: ${vocabulary.length}問`);
} catch (error) {
  console.log("問題データはまだ登録されていません。");
}

// Fisher-Yates shuffle
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

function createPDF(res, questions, type, settings) {
  const isAnswer = type === "answer";

  const doc = new PDFDocument({
    size: "A4",
    margin: 45,
    bufferPages: true
  });

  const filename = isAnswer
    ? `answer_${settings.start}-${settings.end}_${settings.count}.pdf`
    : `test_${settings.start}-${settings.end}_${settings.count}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${filename}"`
  );

  doc.pipe(res);

  // 表紙
  doc
    .fontSize(14)
    .text("TAKEDA JUKU MUSASHISAKAI", {
      align: "center"
    });

  doc.moveDown(3);

  doc
    .fontSize(30)
    .text(
      isAnswer ? "ANSWER BOOK" : "CHECK TEST",
      { align: "center" }
    );

  doc.moveDown(1);

  doc
    .fontSize(20)
    .text(
      isAnswer ? "MODEL ANSWER / STAFF ONLY" : "CONFIRMATION TEST",
      { align: "center" }
    );

  doc.moveDown(4);

  doc.fontSize(13);

  doc.text(`Book : System English`);
  doc.moveDown(0.7);

  doc.text(
    `Range : No.${settings.start} - No.${settings.end}`
  );

  doc.moveDown(0.7);

  doc.text(`Questions : ${settings.count}`);

  doc.addPage();

  // 問題
  questions.forEach((item, index) => {
    if (doc.y > 740) {
      doc.addPage();
    }

    doc
      .fontSize(11)
      .text(
        `${index + 1}.  [No.${item.no}]  ${item.word}`,
        {
          continued: isAnswer
        }
      );

    if (isAnswer) {
      doc.text(`    ${item.answer}`);
    } else {
      doc.moveDown(1.1);
      doc.text(
        "____________________________________________________________"
      );
    }

    doc.moveDown(1);
  });

  // 解答冊子は全ページに識別表示
  if (isAnswer) {
    const range = doc.bufferedPageRange();

    for (
      let i = range.start;
      i < range.start + range.count;
      i++
    ) {
      doc.switchToPage(i);

      doc
        .fontSize(8)
        .text(
          "MODEL ANSWER / STAFF ONLY",
          45,
          810,
          {
            align: "right",
            width: 500
          }
        );
    }
  }

  doc.end();
}

// ヘルスチェック
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    questions: vocabulary.length
  });
});

// PDF生成
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
      return res
        .status(400)
        .send("入力値が正しくありません。");
    }

    if (
      start < 1 ||
      end > 2027 ||
      start > end
    ) {
      return res
        .status(400)
        .send("出題範囲が正しくありません。");
    }

    if (count < 1 || count > 100) {
      return res
        .status(400)
        .send("出題数は1〜100問で指定してください。");
    }

    const questions = selectQuestions(
      start,
      end,
      count,
      order
    );

    createPDF(
      res,
      questions,
      type,
      {
        start,
        end,
        count
      }
    );

  } catch (error) {
    console.error(error);

    res
      .status(500)
      .send(error.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `確認テストサーバー起動: port ${PORT}`
  );
});
