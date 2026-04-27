(async function () {
  try {
    const res = await fetch("http://localhost:5100/api/deployments?limit=200");
    if (!res.ok) {
      console.error("list failed", res.status);
      process.exit(1);
    }
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data.rows || [];
    const building = rows.filter((d) => d.status === "building");
    if (building.length === 0) {
      console.log("no building deployments");
      process.exit(0);
    }
    for (const d of building) {
      console.log("stopping", d.id);
      const r = await fetch(
        `http://localhost:5100/api/deployments/${d.id}/stop`,
        { method: "POST" },
      );
      console.log("stop", d.id, "=>", r.status);
      const t = await r.text();
      if (t) console.log(t);
    }
  } catch (e) {
    console.error("err", e && e.stack ? e.stack : String(e));
    process.exit(1);
  }
})();
