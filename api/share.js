
import crypto from "node:crypto";

const TABLE = "SHARE_LINKS";
const MATCH_TABLE = "Matches";
const PROFILE_TABLE = "PROFILES";
const SITE_URL = "https://sambanda-profile-site.vercel.app";
const EXPIRY_DAYS = 7;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["POST", "GET"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed." });
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
      throw new Error("Airtable record lookup failed.");
    }

    return response.json();
  };

  try {
    // GET: Validate a recipient's share token and retrieve profile.
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

      const fields = share.fields || {};
      const expiry = Date.parse(fields["Expires At"] || "");

      if (!Number.isFinite(expiry) || Date.now() >= expiry) {
        return res.status(410).json({
          error: "This share link has expired."
        });
      }

      const matchId = fields["Match"]?.[0];
      const sharedProfileId = fields["Shared Profile"]?.[0];
      const recipientProfileId = fields["Recipient Profile"]?.[0];

      if (!matchId || !sharedProfileId || !recipientProfileId) {
        return res.status(403).json({
          error: "Share link configuration is incomplete."
        });
      }

      if (sharedProfileId === recipientProfileId) {
        return res.status(403).json({
          error: "Invalid sharing configuration."
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

      const f = profileRecord.fields || {};

      if (f["Profile Status"] !== "ACTIVE") {
        return res.status(404).json({
          error: "This profile is no longer available."
        });
      }

      // Explicit Level 1 public-field whitelist.
      const profile = {
        profileId: f["Sambandh ID"] || "",
        firstName: f["First Name"] || "",
        gender: f["Gender"] || "",
      
        age: f["Age"] ?? "",
        height: f["Height (cm)"] ?? "",
        currentCity: f["Current City"] || "",
        nativePlace: f["Native Place"] || "",
        maritalStatus: f["Marital Status"] || "",
        vertical: f["Vertical"] || "",
        education:
          f["Highest Education"] || f["Education"] || "",
        profession:
          f["Profession Category"] || f["Profession"] || "",
        organisation: f["Organisation/Business"] || "",
        languages: f["Languages"] || "",
        aboutMe: f["About Me"] || "",
        expectations: f["Expectations"] || "",
       primaryPhoto: f["Primary Photograph"]?.[0]?.url || ""
      };

      return res.status(200).json({
        success: true,
        profile
      });
    }

    // POST: Generate a share link (existing protected workflow).
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
      return res.status(401).json({ error: "Unauthorized." });
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

    if (!matchId || !sharedProfileId || !recipientProfileId) {
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
