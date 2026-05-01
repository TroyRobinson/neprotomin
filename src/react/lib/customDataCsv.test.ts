import { describe, expect, it } from "vitest";
import {
  collectCsvColumnValuesFile,
  parseCsvRecords,
  previewCsvTransformText,
  profileCsvText,
  suggestColumnRole,
  transformCsvFile,
} from "./customDataCsv";

describe("customDataCsv", () => {
  it("parses quoted commas and multiline fields", () => {
    const parsed = parseCsvRecords('id,note,value\n1,"hello, world",3\n2,"line one\nline two",4\n');

    expect(parsed.records).toEqual([
      ["id", "note", "value"],
      ["1", "hello, world", "3"],
      ["2", "line one\nline two", "4"],
    ]);
    expect(parsed.endedInsideQuote).toBe(false);
  });

  it("profiles attendance-like data and suggests roles", () => {
    const profile = profileCsvText(
      [
        "student_number,schoolid,present,studentmembership,absences,school year,calendar_date",
        "731048,650,1.0,1,0,2024-2025,2025-03-07",
        "709606,200,0.5,1,0.5,2024-2025,2025-03-07",
      ].join("\n"),
    );

    expect(profile.detectedKind).toBe("attendance");
    expect(profile.sampledRows).toBe(2);
    expect(profile.columns.find((column) => column.name === "student_number")?.suggestedRole).toBe("entityId");
    expect(profile.columns.find((column) => column.name === "schoolid")?.suggestedRole).toBe("locationSiteId");
    expect(profile.columns.find((column) => column.name === "present")?.suggestedRole).toBe("measure");
    expect(profile.columns.find((column) => column.name === "calendar_date")?.suggestedRole).toBe("date");
  });

  it("ignores a cut-off final record when parsing a truncated sample", () => {
    const parsed = parseCsvRecords("id,value\n1,10\n2,2", { includePartialRecord: false });

    expect(parsed.records).toEqual([
      ["id", "value"],
      ["1", "10"],
    ]);
  });

  it("recognizes common location fields", () => {
    expect(suggestColumnRole("ZIP", "number")).toBe("locationZip");
    expect(suggestColumnRole("StreetAddress", "text")).toBe("locationAddress");
    expect(suggestColumnRole("City", "text")).toBe("locationCity");
    expect(suggestColumnRole("State", "text")).toBe("locationState");
  });

  it("builds a statData-shaped transform preview from mapped columns", () => {
    const preview = previewCsvTransformText(
      [
        "zip,calendar_date,present,absences",
        "74106,2025-03-07,1,0",
        "74106,2025-03-07,0.5,0.5",
        "74120,2025-03-07,0,1",
      ].join("\n"),
      {
        datasetName: "Attendance",
        roles: {
          zip: "locationZip",
          calendar_date: "date",
          present: "measure",
          absences: "measure",
        },
      },
    );

    expect(preview.locationKind).toBe("ZIP");
    expect(preview.sampledRows).toBe(3);
    expect(preview.measures).toHaveLength(2);
    expect(preview.measures.find((measure) => measure.measureName === "present")?.sampleAreas[0]).toEqual({
      area: "74106",
      date: "2025-03-07",
      value: 0.75,
    });
    expect(preview.statDataRows[0]).toMatchObject({
      statName: "Attendance - present",
      boundaryType: "ZIP",
      date: "2025-03-07",
      type: "percent",
      data: {
        "74106": 0.75,
        "74120": 0,
      },
    });
  });

  it("counts non-numeric survey-style measure responses", () => {
    const preview = previewCsvTransformText(
      ["Siteid,Surveydate,Question 1", "121153,2025/03/07,Mostly Yes", "121153,2025/03/07,No"].join("\n"),
      {
        datasetName: "Survey",
        roles: {
          Siteid: "locationSiteId",
          Surveydate: "date",
          "Question 1": "measure",
        },
      },
    );

    expect(preview.locationKind).toBe("SITE_ID");
    expect(preview.measures[0]?.aggregation).toBe("responseCount");
    expect(preview.statDataRows[0]?.data).toEqual({ "121153": 2 });
    expect(preview.warnings.some((warning) => warning.includes("lookup table"))).toBe(true);
  });

  it("honors explicit measure aggregation choices", () => {
    const preview = previewCsvTransformText(
      ["zip,date,minutes", "74106,2025-03-07,30", "74106,2025-03-07,45", "74120,2025-03-07,20"].join("\n"),
      {
        datasetName: "Attendance",
        roles: {
          zip: "locationZip",
          date: "date",
          minutes: "measure",
        },
        aggregations: {
          minutes: "sum",
        },
      },
    );

    expect(preview.measures[0]?.aggregation).toBe("sum");
    expect(preview.statDataRows[0]?.type).toBe("count");
    expect(preview.statDataRows[0]?.data).toEqual({
      "74106": 75,
      "74120": 20,
    });
  });

  it("defaults membership denominators to summed counts", () => {
    const preview = previewCsvTransformText(
      ["zip,date,studentmembership", "74106,2025-03-07,1", "74106,2025-03-07,1"].join("\n"),
      {
        datasetName: "Attendance",
        roles: {
          zip: "locationZip",
          date: "date",
          studentmembership: "measure",
        },
      },
    );

    expect(preview.measures[0]?.aggregation).toBe("sum");
    expect(preview.statDataRows[0]?.type).toBe("count");
    expect(preview.statDataRows[0]?.data).toEqual({ "74106": 2 });
  });

  it("honors explicit value display choices", () => {
    const preview = previewCsvTransformText(
      ["zip,date,absences", "74106,2025-03-07,0.1", "74120,2025-03-07,0.2"].join("\n"),
      {
        datasetName: "Attendance",
        roles: {
          zip: "locationZip",
          date: "date",
          absences: "measure",
        },
        valueTypes: {
          absences: "rate",
        },
      },
    );

    expect(preview.statDataRows[0]?.type).toBe("rate");
  });

  it("streams a full file transform with progress", async () => {
    const file = new File(
      [
        [
          "zip,date,minutes",
          "74106,2025-03-07,30",
          "74106,2025-03-07,45",
          "74120,2025-03-08,20",
        ].join("\n"),
      ],
      "attendance.csv",
      { type: "text/csv" },
    );
    const progress: Array<{ rowsProcessed: number; bytesRead: number; totalBytes: number }> = [];

    const preview = await transformCsvFile(
      file,
      {
        datasetName: "Attendance",
        roles: {
          zip: "locationZip",
          date: "date",
          minutes: "measure",
        },
        aggregations: {
          minutes: "sum",
        },
      },
      { onProgress: (nextProgress) => progress.push(nextProgress) },
    );

    expect(preview.isComplete).toBe(true);
    expect(preview.sampledRows).toBe(3);
    expect(preview.statDataRows).toHaveLength(2);
    expect(preview.statDataRows.find((row) => row.date === "2025-03-07")?.data).toEqual({ "74106": 75 });
    expect(progress.at(-1)).toMatchObject({
      rowsProcessed: 3,
      bytesRead: file.size,
      totalBytes: file.size,
    });
  });

  it("resolves site IDs to ZIPs during transforms", () => {
    const preview = previewCsvTransformText(
      ["schoolid,date,present", "650,2025-03-07,1", "200,2025-03-07,0", "999,2025-03-07,1"].join("\n"),
      {
        datasetName: "Attendance",
        roles: {
          schoolid: "locationSiteId",
          date: "date",
          present: "measure",
        },
        locationLookups: {
          siteIdToZip: {
            "650": "74106",
            "200": "74120",
          },
        },
      },
    );

    expect(preview.locationKind).toBe("ZIP");
    expect(preview.skippedRows).toBe(1);
    expect(preview.statDataRows[0]?.parentArea).toBe("Oklahoma");
    expect(preview.statDataRows[0]?.boundaryType).toBe("ZIP");
    expect(preview.statDataRows[0]?.type).toBe("percent");
    expect(preview.statDataRows[0]?.data).toEqual({
      "74106": 1,
      "74120": 0,
    });
    expect(preview.unresolvedLocationValues).toEqual(["999"]);
    expect(preview.warnings.some((warning) => warning.includes("not in the ZIP lookup"))).toBe(true);
  });

  it("samples unique values from a selected CSV column", async () => {
    const file = new File(["schoolid,date\n650,2025-03-07\n200,2025-03-07\n650,2025-03-08"], "attendance.csv", {
      type: "text/csv",
    });

    const sample = await collectCsvColumnValuesFile(file, "schoolid");

    expect(sample.values).toEqual(["200", "650"]);
    expect(sample.sampledRows).toBe(3);
  });
});
