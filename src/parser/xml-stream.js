// Streaming extraction of <Record> / <CategorySample> nodes from Apple
// Health export.xml. Constant memory regardless of file size.
import sax from "sax";

export function extractRecords(readable, onRecord) {
  return new Promise((resolve, reject) => {
    const saxStream = sax.createStream(true);
    let parseErrors = 0;

    saxStream.on("error", function (err) {
      // Skip the malformed record and keep going, per FR §8.
      parseErrors++;
      this._parser.error = null;
      this._parser.resume();
    });

    saxStream.on("opentag", (node) => {
      if (node.name !== "Record" && node.name !== "CategorySample") return;
      const a = node.attributes;
      onRecord({
        type: a.type,
        startDate: a.startDate,
        endDate: a.endDate,
        value: a.value,
        unit: a.unit,
      });
    });

    saxStream.on("end", () => resolve({ parseErrors }));
    saxStream.on("error", () => {}); // recovery handled above
    readable.on("error", reject);
    readable.pipe(saxStream);
  });
}
