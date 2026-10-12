
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const id = String(req.query.id || "").trim().toUpperCase();

  if (!/^(VAI|SRV|SMT)-\d{4}$/.test(id)) {
    return res.status(400).json({ error: "Please enter a valid Sambandha ID." });
  }

  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = "PROFILES";

  if (!token || !baseId) {
    return res.status(500).json({ error: "Profile service is not configured yet." });
  }

  try {
    const formula = `{Sambandh ID}='${id}'`;
    const params = new URLSearchParams({
      filterByFormula: formula,
      maxRecords: "1"
    });

    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    if (!response.ok) {
      return res.status(502).json({ error: "Unable to retrieve the profile." });
    }

    const payload = await response.json();
    const record = payload.records?.[0];

    if (!record || record.fields["Profile Status"] !== "ACTIVE") {
      return res.status(404).json({ error: "No public profile was found for that ID." });
    }

    const f = record.fields;

    // Return only explicitly approved public fields.
    const profile = {
      profileId: f["Sambandh ID"] || "",
      firstName: f["First Name"] || "",
      gender: f["Gender"] || "",
      dateOfBirth: f["Date of Birth"] || "",
      age: f["Age"] ?? "",
      height: f["Height (cm)"] ?? "",
      currentCity: f["Current City"] || "",
      nativePlace: f["Native Place"] || "",
      maritalStatus: f["Marital Status"] || "",
      vertical: f["Vertical"] || "",
      education: f["Highest Education"] || f["Education"] || "",
      profession: f["Profession Category"] || f["Profession"] || "",
      organisation: f["Organisation/Business"] || "",
      languages: f["Languages"] || "",
      aboutMe: f["About Me"] || "",
      expectations: f["Expectations"] || "",
      primaryPhoto: ""
    };

    return res.status(200).json(profile);
  } catch {
    return res.status(500).json({ error: "An unexpected error occurred." });
  }
}
