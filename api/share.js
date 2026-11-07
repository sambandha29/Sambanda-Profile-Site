
import crypto from "node:crypto";

const TABLE = "SHARE_LINKS";
const MATCH_TABLE = "Matches";
const PROFILE_TABLE = "PROFILES";
const SITE_URL = "https://sambanda-profile-site.vercel.app";
const EXPIRY_DAYS = 7;

const LINK_FIELDS = {
  preferences: "Preferences",
  family: "Family",
  horoscope: "Horoscope",
  photosDocuments: "Photos/Documents"
};

// Only these PROFILES fields can be returned to a matched candidate.
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

const LINKED_FIELDS = {
  preferences: [
    "Preferred Age Range",
    "Preferred Communities",
    "Preferred Marital Status",
    "Preferred Education",
    "Preferred Profession",
    "Preferred Cities",
    "Preferred Languages",
    "Lifestyle Preferences",
    "Other Expectations",
    "Minimum Age",
    "Maximum Age",
    "Preferred Gender"
  ],
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
    "Horoscope Notes",
    "Horoscope Document"
  ],
  photosDocuments: [
    "Document Type",
    "File",
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
    // GET: Validate the private sharing token.
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

      const match = await getRecord(MATCH_TABLE, matchId);
      const matchFields = match.fields || {};

      if (matchFields["Match Decision"] !== "Approved") {
        return res.status(403).json({
          error: "This match is no longer approved for sharing."
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

      // Retrieve the linked matrimonial records.
      const [
        preferences,
        family,
        horoscope,
        photosDocuments
      ] = await Promise.all([
        getLinkedRecords(
          "PREFERENCES",
          fields[LINK_FIELDS.preferences],
          LINKED_FIELDS.preferences
        ),
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

      // Collect every image attachment from the candidate's records.
      const uploadedPhotos = [];

      for (const record of photosDocuments) {
        const attachments = getAttachments(record.File);

        for (const file of attachments) {
          if (isImageAttachment(file)) {
            uploadedPhotos.push({
              filename: file.filename || "Photograph",
              url: file.url,
              type: file.type || "image"
            });
          }
        }
      }

      // Include the primary photograph as well.
      const primaryAttachments = getAttachments(
        fields["Primary Photograph"]
      );

      for (const file of primaryAttachments) {
        if (isImageAttachment(file)) {
          uploadedPhotos.unshift({
            filename: file.filename || "Primary Photograph",
            url: file.url,
            type: file.type || "image"
          });
        }
      }

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
          fields["Highest Education"] || fields["Education"] || "",
        profession:
          fields["Profession Category"] || fields["Profession"] || "",
        organisation: fields["Organisation/Business"] || "",
        languages: fields["Languages"] || "",
        aboutMe: fields["About Me"] || "",
        expectations: fields["Expectations"] || "",
        primaryPhoto: primaryAttachments[0]?.url || "",

        preferences,
        family,
        horoscope,
        photosDocuments,
        photos: uploadedPhotos
      };

      return res.status(200).json({
        success: true,
        profile
      });
    }

    // POST: Preserve the existing protected share-link generation.
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
