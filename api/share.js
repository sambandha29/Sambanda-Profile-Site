import crypto from "node:crypto";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const secret = process.env.SHARE_LINK_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(500).json({
      error: "Secure sharing is not configured."
    });
  }

  return res.status(501).json({
    error: "Sharing endpoint is not enabled yet."
  });
}
