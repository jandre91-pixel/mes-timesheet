import React, { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { motion } from "framer-motion";
import { Check, Mail, Download, Trash2 } from "lucide-react";

// Minimal in-file Signature Pad (Pointer Events for iOS/Android + desktop)
function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Setup canvas scaling & keep it crisp on retina; also handle window resize
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111827";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Pointer Events unify mouse/pen/touch
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e) => {
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const onUp = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    setIsDrawing(false);
    // Save image only after completing a stroke
    onChange?.(canvasRef.current.toDataURL("image/png"));
    canvasRef.current.releasePointerCapture?.(e.pointerId);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange?.("");
  };

  return (
    <div className="space-y-2">
      <div
        className="border rounded-2xl bg-white shadow-inner"
        style={{ width: "100%", height: 160 }}
      >
<canvas
  ref={canvasRef}
  className="w-full h-full rounded-2xl touch-none select-none"
  onPointerDown={onDown}
  onPointerMove={onMove}
  onPointerUp={onUp}
  onPointerLeave={onUp}
  onContextMenu={(e) => e.preventDefault()}
  style={{ cursor: "crosshair", touchAction: "none" }}  // <-- add this
/>

      </div>
      <button
        type="button"
        onClick={clear}
        className="px-3 py-2 text-sm rounded-xl border shadow hover:bg-gray-50 inline-flex items-center gap-2"
      >
        <Trash2 className="w-4 h-4" /> Clear signature
      </button>
    </div>
  );
}


function Field({ label, children, required }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function calcHours(startTime, finishTime, breakMin) {
  if (!startTime || !finishTime) return "";
  const [sh, sm] = startTime.split(":").map(Number);
  const [fh, fm] = finishTime.split(":").map(Number);
  let minutes = (fh * 60 + fm) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60; // cross-midnight support
  minutes -= Number(breakMin || 0);
  if (minutes < 0) minutes = 0;
  return (minutes / 60).toFixed(2);
}

export default function App() {
  const [form, setForm] = useState({
    company: "Mensura Engineering Surveys",
    jobNumber: "",
    client: "",
    site: "",
    date: new Date().toISOString().slice(0, 10),
    start: "07:00",
    finish: "17:00",
    breakMin: 30,
    hours: "",
    description: "",
    employee: "",
    materials: "",
    clientName: "",
    adminEmail: "",
  });
  const [clientSignature, setClientSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const previewRef = useRef(null);

  // remember admin emails locally
  const [knownAdmins, setKnownAdmins] = useState([]);
  const [setAsDefault, setSetAsDefault] = useState(true);

  useEffect(() => {
    setForm((f) => ({
      ...f,
      hours: calcHours(f.start, f.finish, f.breakMin),
    }));
  }, [form.start, form.finish, form.breakMin]);

  // Load saved admin emails & default once
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("mes_admin_emails") || "[]");
      const def = localStorage.getItem("mes_default_admin_email") || "";
      setKnownAdmins(saved);
      if (def) {
        setForm((f) => ({ ...f, adminEmail: def }));
      }
    } catch (e) {}
  }, []);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const validate = () => {
    const req = [
      "jobNumber",
      "client",
      "site",
      "date",
      "start",
      "finish",
      "employee",
      "description",
      "clientName",
    ];
    for (const k of req) if (!form[k]) return { ok: false, msg: `Missing: ${k}` };
    if (!clientSignature) return { ok: false, msg: "Client signature is required" };
    return { ok: true };
  };

  const saveAdminEmail = (email) => {
    if (!email) return;
    const list = Array.from(new Set([email, ...knownAdmins])).slice(0, 10);
    setKnownAdmins(list);
    localStorage.setItem("mes_admin_emails", JSON.stringify(list));
    if (setAsDefault) {
      localStorage.setItem("mes_default_admin_email", email);
    }
  };

  const downloadPDF = async () => {
    setSubmitting(true);
    const v = validate();
    if (!v.ok) {
      alert(v.msg);
      setSubmitting(false);
      return;
    }
    const node = previewRef.current;
    const canvas = await html2canvas(node, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgProps = { w: canvas.width, h: canvas.height };
    const ratio = Math.min(pageWidth / (imgProps.w / 2), pageHeight / (imgProps.h / 2));
    const w = (imgProps.w / 2) * ratio;
    const h = (imgProps.h / 2) * ratio;
    const x = (pageWidth - w) / 2;
    const y = 10;
    pdf.addImage(imgData, "PNG", x, y, w, h);
    const filename = `Timesheet_${form.jobNumber}_${form.date}.pdf`;
    pdf.save(filename);
    setSubmitting(false);
  };

  const mailto = () => {
    const subject = encodeURIComponent(`Timesheet ${form.jobNumber} - ${form.date}`);
    const body = encodeURIComponent(
      `Hi Admin,\n\nPlease find attached the signed timesheet for job ${form.jobNumber}.\n\nClient: ${form.client}\nSite: ${form.site}\nDate: ${form.date}\nEmployee: ${form.employee}\nHours: ${form.hours}\n\nRegards,\n${form.employee}`
    );
    saveAdminEmail(form.adminEmail);
    window.location.href = `mailto:${form.adminEmail || ""}?subject=${subject}&body=${body}`;
  };

  const reset = () => {
    const def = localStorage.getItem("mes_default_admin_email") || "";
    setForm({
      company: form.company,
      jobNumber: "",
      client: "",
      site: "",
      date: new Date().toISOString().slice(0, 10),
      start: "07:00",
      finish: "17:00",
      breakMin: 30,
      hours: "",
      description: "",
      employee: "",
      materials: "",
      clientName: "",
      adminEmail: def,
    });
    setClientSignature("");
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-semibold tracking-tight"
        >
          Timesheet + Client Sign‑off
        </motion.h1>
        <p className="text-gray-600 mb-6">
          Fill this out onsite, get the client to sign, then download the PDF and email it to admin.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Form */}
          <div className="space-y-4">
            <Field label="Company" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.company} onChange={update("company")} />
            </Field>
            <Field label="Job Number" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.jobNumber} onChange={update("jobNumber")} placeholder="e.g., MB-042" />
            </Field>
            <Field label="Client" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.client} onChange={update("client")} />
            </Field>
            <Field label="Site / Address" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.site} onChange={update("site")} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date" required>
                <input type="date" className="w-full border rounded-xl px-3 py-2" value={form.date} onChange={update("date")} />
              </Field>
              <Field label="Start" required>
                <input type="time" className="w-full border rounded-xl px-3 py-2" value={form.start} onChange={update("start")} />
              </Field>
              <Field label="Finish" required>
                <input type="time" className="w-full border rounded-xl px-3 py-2" value={form.finish} onChange={update("finish")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Break (min)">
                <input type="number" className="w-full border rounded-xl px-3 py-2" value={form.breakMin} onChange={update("breakMin")} />
              </Field>
              <Field label="Hours (auto)">
                <input className="w-full border rounded-xl px-3 py-2 bg-gray-100" value={form.hours} readOnly />
              </Field>
            </div>
            <Field label="Work Description" required>
              <textarea className="w-full border rounded-xl px-3 py-2 min-h-[96px]" value={form.description} onChange={update("description")} placeholder="e.g., Set out culvert headwalls, as-built pickup, QA checks" />
            </Field>
            <Field label="Materials / Extras (optional)">
              <textarea className="w-full border rounded-xl px-3 py-2" value={form.materials} onChange={update("materials")} placeholder="e.g., Consumables, special equipment" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee" required>
                <input className="w-full border rounded-xl px-3 py-2" value={form.employee} onChange={update("employee")} placeholder="e.g., D. Adamson" />
              </Field>
              <Field label="Admin email (recipient)">
                <div className="space-y-2">
                  <input list="adminEmails" type="email" className="w-full border rounded-xl px-3 py-2" value={form.adminEmail} onChange={update("adminEmail")} placeholder="admin@mensurasurveys.com.au" />
                  <datalist id="adminEmails">
                    {knownAdmins.map((e, i) => (<option key={i} value={e} />))}
                  </datalist>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={setAsDefault} onChange={(e)=>setSetAsDefault(e.target.checked)} />
                    Set as default on this device
                  </label>
                </div>
              </Field>
            </div>
            <Field label="Client Name" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.clientName} onChange={update("clientName")} placeholder="e.g., Site Supervisor" />
            </Field>
            <Field label="Client Signature" required>
              <SignaturePad onChange={setClientSignature} />
            </Field>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={downloadPDF}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl shadow border hover:bg-gray-50"
              >
                <Download className="w-4 h-4" /> Download signed PDF
              </button>
              <button
                type="button"
                onClick={mailto}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl shadow border hover:bg-gray-50"
              >
                <Mail className="w-4 h-4" /> Open email draft
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl shadow border hover:bg-gray-50"
              >
                <Trash2 className="w-4 h-4" /> Reset form
              </button>
            </div>
          </div>

          {/* PDF Preview Card */}
          <div className="md:sticky md:top-6">
            <div ref={previewRef} className="bg-white rounded-2xl shadow p-6 border">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Signed Timesheet</h2>
                <span className="text-xs text-gray-500">Preview</span>
              </div>
              <div className="mt-3 text-sm">
                <div className="flex justify-between">
                  <div>
                    <div className="font-medium">{form.company}</div>
                    <div className="text-gray-600">Work Order / Timesheet</div>
                  </div>
                  <div className="text-right text-gray-600">
                    <div>Job: <span className="font-medium">{form.jobNumber || "—"}</span></div>
                    <div>Date: {form.date}</div>
                  </div>
                </div>
                <hr className="my-3" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-gray-600">Client</div>
                    <div className="font-medium">{form.client || "—"}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Site</div>
                    <div className="font-medium">{form.site || "—"}</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 mt-2">
                  <div>
                    <div className="text-gray-600">Start</div>
                    <div className="font-medium">{form.start}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Finish</div>
                    <div className="font-medium">{form.finish}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Break (min)</div>
                    <div className="font-medium">{form.breakMin}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Hours</div>
                    <div className="font-medium">{form.hours || "—"}</div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-gray-600">Work Description</div>
                  <div className="font-medium whitespace-pre-wrap min-h-[64px]">{form.description || "—"}</div>
                </div>
                {form.materials && (
                  <div className="mt-3">
                    <div className="text-gray-600">Materials / Extras</div>
                    <div className="font-medium whitespace-pre-wrap">{form.materials}</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <div className="text-gray-600">Employee</div>
                    <div className="font-medium">{form.employee || "—"}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Client Name</div>
                    <div className="font-medium">{form.clientName || "—"}</div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-gray-600 mb-1">Client Signature</div>
                  <div className="border rounded-xl p-2 h-32 flex items-center justify-center bg-white">
                    {clientSignature ? (
                      <img src={clientSignature} alt="Signature" className="max-h-28 object-contain" />
                    ) : (
                      <div className="text-gray-400 text-sm flex items-center gap-2"><Check className="w-4 h-4"/> Awaiting signature…</div>
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-gray-500 mt-2">
                  By signing, the client confirms the above work was completed satisfactorily and authorises invoicing.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-xs text-gray-500">
          Tip: Admin email is saved only on this device (no server). To auto-send PDFs without opening your mail app, add EmailJS or a simple webhook later.
        </div>
      </div>
    </div>
  );
}
