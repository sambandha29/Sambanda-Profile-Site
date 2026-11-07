
import crypto from "node:crypto";

const TABLE = "SHARE_LINKS";
const MATCH_TABLE = "Matches";
const PROFILE_TABLE = "PROFILES";
const SITE_URL = "https://sambanda-profile-site.vercel.app";
const EXPIRY_DAYS = 7;

const LINK_FIELDS = {
  family: "Family",
  horoscope: "Horoscope",
  photosDocuments: "Photos/Documents"
};

// Explicit whitelist of candidate-facing PROFILES fields.
// Internal Airtable fields and Partner Preferences are excluded.
const PROFILE_FIELDS = [
  "Sambandh ID",
  "First Name",
  "Gender",
  "DOB",
  "Date of Birth",
  "Age",
  "Height (cm)",
  "Current City",
  "Native Place",
  "Marital Status",
  "Vertical",
  "Highest Education",
  "Education",
  "Profession Category",
  "Profession",
  "Organisation/Business",
  "Languages",
  "About Me",
  "Expectations",
  "Profile Headline",
  "Detailed Personal Information",
  "Qualification Details",
  "Income Range",
  "Family Background",
  "Additional Information",
  "Primary Photograph",
  "Phone",
  "Phone Number",
  "Mobile",
  "Mobile Number",
  "Email",
  "Email Address"
];

// Only relevant candidate-facing fields from linked tables.
const LINKED_FIELDS = {
  family: [
    "Father's Name",
    "Father's Occupation",
    "Mother's Name",
    "Mother's Occupation",
    "Siblings Details",
    "Family Income Range",
    "Additional Family Information"
  ],

  horoscope: [
    "Nakshatra",
    "Rashi",
    "Gotra",
    "Pravara",
    "Date of Birth",
    "Time of Birth",
    "Birth Place",
    "Pada",
    "Lagna",
    "Vedic Shakha",
    "Horoscope Notes"
  ],

  photosDocuments: [
    "Document Type",
    "Document Notes"
  ]
};

function selectFields(fields = {}, allowed = []) {
  const result = {};

  for (const name of allowed) {
    if (
      Object.prototype.hasOwnProperty.call(fields, name) &&
      fields[name] !== null &&
      fields[name] !== undefined &&
      fields[name] !== ""
    ) {
      result[name] = fields[name];
    }
  }

  return result;
}

function getAttachments(value) {
  if (!Array.isArray(value)) return [];

  return value.filter(item =>
    item &&
    typeof item.url === "string" &&
    item.url.startsWith("https://")
  );
}

function isImageAttachment(file) {
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.filename || "").toLowerCase();

  return (
    mime.startsWith("image/") ||
    /\.(jpg|jpeg|png|webp|gif|heic|heif|tif|tiff)$/i.test(name)
  );
}

function cleanAttachment(file, documentType = "") {
  return {
    filename: file.filename || "Uploaded file",
    url: file.url,
    type: file.type || "",
    documentType: documentType || "",
    size: file.size || null
  };
}

function collectAttachments(records = [], fieldName = "File") {
  const photos = [];
  const documents = [];

  for (const record of records) {
    const attachments = getAttachments(record[fieldName]);
    const documentType = record["Document Type"] || "";

    for (const file of attachments) {
      const attachment = cleanAttachment(file, documentType);

      if (isImageAttachment(file)) {
        photos.push(attachment);
      } else {
        documents.push(attachment);
      }
    }
  }

  return { photos, documents };
}

function collectHoroscopeDocuments(records = []) {
  const documents = [];

  for (const record of records) {
    const attachments = getAttachments(record["Horoscope Document"]);

    for (const file of attachments) {
      documents.push(cleanAttachment(file, "Horoscope Document"));
    }
  }

  return documents;
}

function uniqueAttachments(items = []) {
  const seen = new Set();

  return items.filter(item => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token || !baseId) {
    return res.status(500).json({
      error: "Airtable configuration is incomplete."
    });
  }

  const api = `https://api.airtable.com/v0/${baseId}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const getRecord = async (table, id) => {
    const response = await fetch(
      `${api}/${encodeURIComponent(table)}/${id}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Airtable lookup failed for ${table}.`);
    }

    return response.json();
  };

  const getLinkedRecords = async (table, ids, allowedFields) => {
    if (!Array.isArray(ids) || ids.length === 0) {
      return [];
    }

    const records = await Promise.all(
      ids.map(id => getRecord(table, id))
    );

    return records.map(record =>
      selectFields(record.fields || {}, allowedFields)
    );
  };

  try {
    // ==========================================
    // GET: Validate and display a private link.
    // ==========================================
    if (req.method === "GET") {
      const rawToken = String(req.query?.token || "").trim();

      if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
        return res.status(400).json({
          error: "Invalid or missing share token."
        });
      }

      const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");

      const params = new URLSearchParams({
        filterByFormula: `{Share Token} = '${tokenHash}'`,
        maxRecords: "1"
      });

      const lookup = await fetch(
        `${api}/${encodeURIComponent(TABLE)}?${params}`,
        { headers }
      );

      if (!lookup.ok) {
        throw new Error("Share link lookup failed.");
      }

      const result = await lookup.json();
      const share = result.records?.[0];

      if (!share) {
        return res.status(404).json({
          error: "This share link is invalid."
        });
      }

      const shareFields = share.fields || {};
      const expiry = Date.parse(shareFields["Expires At"] || "");

      if (!Number.isFinite(expiry) || Date.now() >= expiry) {
        return res.status(410).json({
          error: "This share link has expired."
        });
      }

      if (shareFields["Revoked At"]) {
        return res.status(410).json({
          error: "This share link has been revoked."
        });
      }

      const matchId = shareFields["Match"]?.[0];
      const sharedProfileId = shareFields["Shared Profile"]?.[0];
      const recipientProfileId = shareFields["Recipient Profile"]?.[0];

      if (
        !matchId ||
        !sharedProfileId ||
        !recipientProfileId ||
        sharedProfileId === recipientProfileId
      ) {
        return res.status(403).json({
          error: "Share link configuration is invalid."
        });
      }

      // Verify that the match is still approved.
      const match = await getRecord(MATCH_TABLE, matchId);
      const matchFields = match.fields || {};

      if (matchFields["Match Decision"] !== "Approved") {
        return res.status(403).json({
          error: "This match is no longer approved for sharing."
        });
      }

      // Verify both profiles belong to this match.
      const profileA = matchFields["Profile A"]?.[0];
      const profileB = matchFields["Profile B"]?.[0];

      if (
        ![profileA, profileB].includes(sharedProfileId) ||
        ![profileA, profileB].includes(recipientProfileId)
      ) {
        return res.status(403).json({
          error: "Profiles do not belong to this match."
        });
      }

      // Retrieve the candidate whose profile is being shared.
      const profileRecord = await getRecord(
        PROFILE_TABLE,
        sharedProfileId
      );

      const fields = profileRecord.fields || {};

      if (fields["Profile Status"] !== "ACTIVE") {
        return res.status(404).json({
          error: "This profile is no longer available."
        });
      }

      // Retrieve only candidate-facing linked records.
      // PREFERENCES is deliberately not retrieved.
      const [
        family,
        horoscope,
        photosDocuments
      ] = await Promise.all([
        getLinkedRecords(
          "FAMILY",
          fields[LINK_FIELDS.family],
          LINKED_FIELDS.family
        ),

        getLinkedRecords(
          "HOROSCOPE",
          fields[LINK_FIELDS.horoscope],
          LINKED_FIELDS.horoscope
        ),

        getLinkedRecords(
          "PHOTOS_DOCUMENTS",
          fields[LINK_FIELDS.photosDocuments],
          LINKED_FIELDS.photosDocuments
        )
      ]);

      // Retrieve every uploaded photograph and document.
      const uploaded = collectAttachments(
        photosDocuments,
        "File"
      );

      // Include the primary photograph.
      const primaryAttachments = getAttachments(
        fields["Primary Photograph"]
      );

      const primaryPhotos = primaryAttachments
        .filter(isImageAttachment)
        .map(file => cleanAttachment(file, "Primary Photograph"));

      // Include horoscope documents as well.
      const horoscopeDocuments =
        collectHoroscopeDocuments(
          // Retrieve original HOROSCOPE records for attachment fields.
          await Promise.all(
            (fields[LINK_FIELDS.horoscope] || []).map(
              id => getRecord("HOROSCOPE", id)
            )
          ).then(records =>
            records.map(record => record.fields || {})
          )
        );

      const photos = uniqueAttachments([
        ...primaryPhotos,
        ...uploaded.photos
      ]);

      const documents = uniqueAttachments([
        ...uploaded.documents,
        ...horoscopeDocuments
      ]);

      // Build the complete candidate-facing profile.
      const profile = {
        ...selectFields(fields, PROFILE_FIELDS),

        profileId: fields["Sambandh ID"] || "",
        firstName: fields["First Name"] || "",
        gender: fields["Gender"] || "",
        age: fields["Age"] ?? "",
        height: fields["Height (cm)"] ?? "",
        currentCity: fields["Current City"] || "",
        nativePlace: fields["Native Place"] || "",
        maritalStatus: fields["Marital Status"] || "",
        vertical: fields["Vertical"] || "",

        education:
          fields["Highest Education"] ||
          fields["Education"] ||
          "",

        profession:
          fields["Profession Category"] ||
          fields["Profession"] ||
          "",

        organisation:
          fields["Organisation/Business"] || "",

        languages: fields["Languages"] || "",
        aboutMe: fields["About Me"] || "",
        expectations: fields["Expectations"] || "",

        primaryPhoto: primaryPhotos[0]?.url || "",

        family,
        horoscope,
        photos,
        documents
      };

      return res.status(200).json({
        success: true,
        profile
      });
    }

    // ==========================================
    // POST: Existing protected link generation.
    // ==========================================
    const secret = process.env.SHARE_LINK_SECRET;
    const suppliedSecret = req.headers["x-share-secret"];

    if (
      !secret ||
      typeof suppliedSecret !== "string" ||
      suppliedSecret.length !== secret.length ||
      !crypto.timingSafeEqual(
        Buffer.from(suppliedSecret),
        Buffer.from(secret)
      )
    ) {
      return res.status(401).json({
        error: "Unauthorized."
      });
    }

    const recordId = String(req.body?.recordId || "").trim();

    if (!/^rec[A-Za-z0-9]{14,}$/.test(recordId)) {
      return res.status(400).json({
        error: "Invalid SHARE_LINKS record ID."
      });
    }

    const share = await getRecord(TABLE, recordId);
    const fields = share.fields || {};

    if (fields["Share URL"] || fields["Share Token"]) {
      return res.status(409).json({
        error: "This share link has already been generated."
      });
    }

    const matchId = fields["Match"]?.[0];
    const sharedProfileId = fields["Shared Profile"]?.[0];
    const recipientProfileId = fields["Recipient Profile"]?.[0];

    if (
      !matchId ||
      !sharedProfileId ||
      !recipientProfileId
    ) {
      return res.status(400).json({
        error: "Match, Shared Profile and Recipient Profile are required."
      });
    }

    if (sharedProfileId === recipientProfileId) {
      return res.status(400).json({
        error: "The shared and recipient profiles must be different."
      });
    }

    const match = await getRecord(MATCH_TABLE, matchId);
    const matchFields = match.fields || {};

    if (matchFields["Match Decision"] !== "Approved") {
      return res.status(403).json({
        error: "Only approved matches can be shared."
      });
    }

    const profileA = matchFields["Profile A"]?.[0];
    const profileB = matchFields["Profile B"]?.[0];

    if (
      ![profileA, profileB].includes(sharedProfileId) ||
      ![profileA, profileB].includes(recipientProfileId)
    ) {
      return res.status(403).json({
        error: "Profiles do not belong to this match."
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const expiresAt = new Date(
      Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const shareUrl =
      `${SITE_URL}/?token=${encodeURIComponent(rawToken)}`;

    const update = await fetch(
      `${api}/${encodeURIComponent(TABLE)}/${recordId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          fields: {
            "Share Token": tokenHash,
            "Share URL": shareUrl,
            "Expires At": expiresAt
          }
        })
      }
    );

    if (!update.ok) {
      const airtableError = await update.json().catch(() => ({}));

      throw new Error(
        `Airtable update failed (${update.status}): ${
          airtableError.error?.message ||
          JSON.stringify(airtableError)
        }`
      );
    }

    return res.status(200).json({
      success: true,
      shareUrl,
      expiresAt
    });

  } catch (error) {
    console.error("Share link error:", error.message);

    return res.status(500).json({
      error: "Unable to process the share link."
    });
  }
}
