import React, { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { motion } from "framer-motion";
import { Check, Mail, Download, Trash2, Lock, Unlock } from "lucide-react";
import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";

// ==========================
// Microsoft Graph (Outlook) – per-employee sending
// ==========================
// 👉 Replace these two values after you create the Azure App Registration
const msalConfig = {
  auth: {
    clientId: "REPLACE_WITH_YOUR_CLIENT_ID",
    authority: "https://login.microsoftonline.com/REPLACE_WITH_YOUR_TENANT_ID",
    redirectUri: typeof window !== "undefined" ? window.location.origin : "",
  },
  cache: { cacheLocation: "localStorage" },
};
const msalInstance = typeof window !== "undefined" ? new PublicClientApplication(msalConfig) : null;

// ------------------------------
// Robust Signature Pad: iPhone/Android/Mouse
// ------------------------------
function SignaturePad({ onChange, disabled }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

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

  const posFromEvt = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    if (e.touches && e.touches.length) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    const cx = e.clientX ?? (e.nativeEvent?.clientX ?? 0);
    const cy = e.clientY ?? (e.nativeEvent?.clientY ?? 0);
    return { x: cx - rect.left, y: cy - rect.top };
  };

  const begin = (e) => {
    if (disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = posFromEvt(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
    if (e.pointerId && canvasRef.current.setPointerCapture) canvasRef.current.setPointerCapture(e.pointerId);
  };
  const draw = (e) => {
    if (disabled || !drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = posFromEvt(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = (e) => {
    if (disabled || !drawingRef.current) return;
    e.preventDefault();
    drawingRef.current = false;
    onChange?.(canvasRef.current.toDataURL("image/png"));
    if (e?.pointerId && canvasRef.current.releasePointerCapture) canvasRef.current.releasePointerCapture(e.pointerId);
  };

  const clear = () => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange?.("");
  };

  return (
    <div className="space-y-2">
      <div className="border rounded-2xl bg-white shadow-inner relative" style={{ width: "100%", height: 160 }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-2xl touch-none select-none"
          onPointerDown={begin}
          onPointerMove={draw}
          onPointerUp={end}
          onPointerLeave={end}
          onMouseDown={begin}
          onMouseMove={draw}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={begin}
          onTouchMove={draw}
          onTouchEnd={end}
          onTouchCancel={end}
          style={{ cursor: disabled ? "not-allowed" : "crosshair", touchAction: "none" }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {disabled && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] rounded-2xl flex items-center justify-center text-sm text-gray-600">
            <Lock className="w-4 h-4 mr-1" /> Locked after signature
          </div>
        )}
      </div>
      {!disabled && (
        <button type="button" onClick={clear} className="px-3 py-2 text-sm rounded-xl border shadow hover:bg-gray-50 inline-flex items-center gap-2">
          <Trash2 className="w-4 h-4" /> Clear signature
        </button>
      )}
    </div>
  );
}

// Utility: calculate hours
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

async function sha256Hex(obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const hash = await crypto.subtle.digest("SHA-256", data);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
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
    clientAdminEmail: "",
    personalAdminEmail: "",
  });

  const [clientSignature, setClientSignature] = useState("");
  const [isSealed, setIsSealed] = useState(false);
  const [sealedAt, setSealedAt] = useState("");
  const [lockedForm, setLockedForm] = useState(null);
  const [verificationId, setVerificationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const previewRef = useRef(null);

  // Remember emails locally on device
  const [knownClientAdmins, setKnownClientAdmins] = useState([]);
  const [knownPersonalAdmins, setKnownPersonalAdmins] = useState([]);
  const [personalAsDefault, setPersonalAsDefault] = useState(true);

  useEffect(() => {
    setForm((f) => ({ ...f, hours: calcHours(f.start, f.finish, f.breakMin) }));
  }, [form.start, form.finish, form.breakMin]);

  useEffect(() => {
    try {
      const a = JSON.parse(localStorage.getItem("mes_client_admins") || "[]");
      const b = JSON.parse(localStorage.getItem("mes_personal_admins") || "[]");
      const def = localStorage.getItem("mes_personal_admin_default") || "";
      setKnownClientAdmins(a);
      setKnownPersonalAdmins(b);
      if (def) setForm((f) => ({ ...f, personalAdminEmail: def }));
    } catch {}
  }, []);

  // MSAL: Handle post-login redirect & keep an active account
  useEffect(() => {
    if (!msalInstance) return;
    msalInstance.handleRedirectPromise().then((res) => {
      if (res?.account) msalInstance.setActiveAccount(res.account);
    });
  }, []);

  const update = (k) => (e) => {
    if (isSealed) return; // locked after signature
    setForm({ ...form, [k]: e.target.value });
  };

  const saveEmails = () => {
    if (form.clientAdminEmail) {
      const list = Array.from(new Set([form.clientAdminEmail, ...knownClientAdmins])).slice(0, 10);
      setKnownClientAdmins(list);
      localStorage.setItem("mes_client_admins", JSON.stringify(list));
    }
    if (form.personalAdminEmail) {
      const list = Array.from(new Set([form.personalAdminEmail, ...knownPersonalAdmins])).slice(0, 10);
      setKnownPersonalAdmins(list);
      localStorage.setItem("mes_personal_admins", JSON.stringify(list));
      if (personalAsDefault) localStorage.setItem("mes_personal_admin_default", form.personalAdminEmail);
    }
  };

  const seal = async () => {
    // Lock the form and compute a verification hash
    const payload = { ...form, clientSignature };
    const hash = await sha256Hex(payload);
    setIsSealed(true);
    setSealedAt(new Date().toISOString());
    setLockedForm({ ...form });
    setVerificationId(hash);
  };

  const onSignature = async (dataUrl) => {
    setClientSignature(dataUrl);
    if (dataUrl && !isSealed) await seal();
  };

  const unlock = () => {
    if (!confirm("Clear signature and unlock the form?")) return;
    setClientSignature("");
    setIsSealed(false);
    setSealedAt("");
    setLockedForm(null);
    setVerificationId("");
  };

  const validate = () => {
    const req = ["jobNumber", "client", "site", "date", "start", "finish", "employee", "description", "clientName", "clientAdminEmail", "personalAdminEmail"];
    for (const k of req) if (!form[k]) return { ok: false, msg: `Missing: ${k}` };
    if (!clientSignature) return { ok: false, msg: "Client signature is required" };
    return { ok: true };
  };

  const pdfDataSource = isSealed && lockedForm ? lockedForm : form;

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
    const ratio = Math.min(pageWidth / (canvas.width / 2), pageHeight / (canvas.height / 2));
    const w = (canvas.width / 2) * ratio;
    const h = (canvas.height / 2) * ratio;
    const x = (pageWidth - w) / 2;
    const y = 10;
    pdf.addImage(imgData, "PNG", x, y, w, h);
    const filename = `Timesheet_${pdfDataSource.jobNumber}_${pdfDataSource.date}.pdf`;
    pdf.save(filename);
    setSubmitting(false);
  };

  const mailto = () => {
    saveEmails();
    const subject = encodeURIComponent(`[MES] ${pdfDataSource.employee || "Employee"} — ${pdfDataSource.client} — ${pdfDataSource.date} (${pdfDataSource.jobNumber})`);
    const body = encodeURIComponent(
      `Signed at: ${sealedAt || "(not sealed)"}
Verification ID: ${verificationId ? verificationId.slice(0, 16) : "n/a"}

Client: ${pdfDataSource.client}
Site: ${pdfDataSource.site}
Date: ${pdfDataSource.date}
Employee: ${pdfDataSource.employee}
Hours: ${pdfDataSource.hours}

This email includes two recipients: Client Admin and Your Admin.`
    );
    const to = [pdfDataSource.clientAdminEmail, pdfDataSource.personalAdminEmail].filter(Boolean).join(",");
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };

  // ---------- Outlook (Graph) send as the employee ----------
  const renderPdfBlob = async () => {
    const node = previewRef.current;
    const canvas = await html2canvas(node, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageWidth / (canvas.width / 2), pageHeight / (canvas.height / 2));
    const w = (canvas.width / 2) * ratio;
    const h = (canvas.height / 2) * ratio;
    const x = (pageWidth - w) / 2;
    pdf.addImage(imgData, "PNG", x, 10, w, h);
    return pdf.output("blob");
  };

  const blobToBase64 = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.readAsDataURL(blob);
  });

  const ensureLogin = async () => {
    if (!msalInstance) throw new Error("MSAL not initialised");
    let acc = msalInstance.getActiveAccount();
    if (!acc) {
      try {
        await msalInstance.loginPopup({ scopes: ["Mail.Send"] });
      } catch (e) {
        // Popup may fail on iPhone; fall back to redirect
        await msalInstance.loginRedirect({ scopes: ["Mail.Send"] });
        return false; // redirecting
      }
      acc = msalInstance.getActiveAccount();
    }
    return true;
  };

  const getToken = async () => {
    const account = msalInstance.getActiveAccount();
    try {
      const res = await msalInstance.acquireTokenSilent({ scopes: ["Mail.Send"], account });
      return res.accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        const res = await msalInstance.acquireTokenPopup({ scopes: ["Mail.Send"] });
        return res.accessToken;
      }
      throw e;
    }
  };

  const sendViaOutlook = async () => {
    const v = validate();
    if (!v.ok) { alert(v.msg); return; }

    const logged = await ensureLogin();
    if (!logged) return; // was redirected to login

    const token = await getToken();
    const pdfBlob = await renderPdfBlob();
    const contentBytes = await blobToBase64(pdfBlob);
    const filename = `Timesheet_${pdfDataSource.jobNumber}_${pdfDataSource.date}.pdf`;

    const toRecipients = [pdfDataSource.clientAdminEmail, pdfDataSource.personalAdminEmail]
      .filter(Boolean)
      .map((addr) => ({ emailAddress: { address: addr } }));

    const subject = `[MES] ${pdfDataSource.employee || "Employee"} — ${pdfDataSource.client} — ${pdfDataSource.date} (${pdfDataSource.jobNumber})`;

    const message = {
      message: {
        subject,
        body: {
          contentType: "Text",
          content: `Signed at: ${sealedAt || "(not sealed)"}
Verification ID: ${verificationId ? verificationId.slice(0,16) : "n/a"}

Client: ${pdfDataSource.client}
Site: ${pdfDataSource.site}
Date: ${pdfDataSource.date}
Employee: ${pdfDataSource.employee}
Hours: ${pdfDataSource.hours}`,
        },
        toRecipients,
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: filename,
            contentType: "application/pdf",
            contentBytes,
          },
        ],
      },
      saveToSentItems: true,
    };

    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (res.ok) alert("Sent from your Outlook mailbox ✅");
    else {
      const err = await res.text();
      alert("Send failed: " + err);
    }
  };

  const reset = () => {
    const def = localStorage.getItem("mes_personal_admin_default") || "";
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
      clientAdminEmail: "",
      personalAdminEmail: def,
    });
    setClientSignature("");
    setIsSealed(false);
    setSealedAt("");
    setLockedForm(null);
    setVerificationId("");
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <motion.h1 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-semibold tracking-tight">
          Timesheet + Client Sign‑off
        </motion.h1>
        <p className="text-gray-600 mb-6">Fill this out onsite, get the client to sign, then download the PDF and email it to both admins.</p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Form */}
          <div className="space-y-4">
            <Field label="Company" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.company} onChange={update("company")} disabled={isSealed} />
            </Field>
            <Field label="Job Number" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.jobNumber} onChange={update("jobNumber")} placeholder="e.g., MB-042" disabled={isSealed} />
            </Field>
            <Field label="Client" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.client} onChange={update("client")} disabled={isSealed} />
            </Field>
            <Field label="Site / Address" required>
              <input className="w-full border rounded-xl px-3 py-2" value={form.site} onChange={update("site")} disabled={isSealed} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date" required>
                <input type="date" className="w-full border rounded-xl px-3 py-2" value={form.date} onChange={update("date")} disabled={isSealed} />
              </Field>
              <Field label="Start" required>
                <input type="time" className="w-full border rounded-xl px-3 py-2" value={form.start} onChange={update("start")} disabled={isSealed} />
              </Field>
              <Field label="Finish" required>
                <input type="time" className="w-full border rounded-xl px-3 py-2" value={form.finish} onChange={update("finish")} disabled={isSealed} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Break (min)">
                <input type="number" className="w-full border rounded-xl px-3 py-2" value={form.breakMin} onChange={update("breakMin")} disabled={isSealed} />
              </Field>
              <Field label="Hours (auto)">
                <input className="w-full border rounded-xl px-3 py-2 bg-gray-100" value={form.hours} readOnly />
              </Field>
            </div>
            <Field label="Work Description" required>
              <textarea className="w-full border rounded-xl px-3 py-2 min-h-[96px]" value={form.description} onChange={update("description")} placeholder="e.g., Set out culvert headwalls, as-built pickup, QA checks" disabled={isSealed} />
            </Field>
            <Field label="Materials / Extras (optional)">
              <textarea className="w-full border rounded-xl px-3 py-2" value={form.materials} onChange={update("materials")} placeholder="e.g., Consumables, special equipment" disabled={isSealed} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee" required>
                <input className="w-full border rounded-xl px-3 py-2" value={form.employee} onChange={update("employee")} placeholder="e.g., D. Adamson" disabled={isSealed} />
              </Field>
              <Field label="Client Admin Email (To)" required>
                <div className="space-y-2">
                  <input list="clientAdmins" type="email" className="w-full border rounded-xl px-3 py-2" value={form.clientAdminEmail} onChange={update("clientAdminEmail")} placeholder="client.admin@company.com" disabled={isSealed} />
                  <datalist id="clientAdmins">{knownClientAdmins.map((e, i) => (<option key={i} value={e} />))}</datalist>
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your Admin Email (CC/To)" required>
                <div className="space-y-2">
                  <input list="personalAdmins" type="email" className="w-full border rounded-xl px-3 py-2" value={form.personalAdminEmail} onChange={update("personalAdminEmail")} placeholder="admin@mensurasurveys.com.au" disabled={isSealed} />
                  <datalist id="personalAdmins">{knownPersonalAdmins.map((e, i) => (<option key={i} value={e} />))}</datalist>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={personalAsDefault} onChange={(e) => setPersonalAsDefault(e.target.checked)} disabled={isSealed} />
                    Set as default on this device
                  </label>
                </div>
              </Field>
              <Field label="Client Name" required>
                <input className="w-full border rounded-xl px-3 py-2" value={form.clientName} onChange={update("clientName")} placeholder="e.g., Site Supervisor" disabled={isSealed} />
              </Field>
            </div>

            <Field label="Client Signature" required>
              <SignaturePad onChange={onSignature} disabled={isSealed} />
              {isSealed ? (
                <div className="flex items-center gap-2 text-green-700 text-sm mt-2"><Lock className="w-4 h-4"/> Sealed at {new Date(sealedAt).toLocaleString()} • Verification ID: <span className="font-mono">{verificationId.slice(0,16)}</span></div>
              ) : (
                <div className="text-xs text-gray-500 mt-1">Once the client signs, the form locks. To make changes, you must clear the signature.</div>
              )}
              {isSealed && (
                <button type="button" onClick={unlock} className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-xl border shadow hover:bg-gray-50">
                  <Unlock className="w-4 h-4"/> Clear signature & unlock
                </button>
              )}
            </Field>

            <div className="flex flex-wrap gap-3 pt-2">
              <button type="button" onClick={downloadPDF} disabled={submitting} className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl shadow border hover:bg-gray-50">
                <Download className="w-4 h-4" /> Download signed PDF
              </button>
              <button type="button" onClick={mailto} className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl shadow border hover:bg-gray-50">
                <Mail className="w-4 h-4" /> Open email draft (both)
              </button>
              <button type="button" onClick={sendViaOutlook} className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl shadow border hover:bg-gray-50">
                <Mail className="w-4 h-4" /> Send via Outlook (auto)
              </button>
              <button type="button" onClick={reset} className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl shadow border hover:bg-gray-50">
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
                    <div className="font-medium">{pdfDataSource.company}</div>
                    <div className="text-gray-600">Work Order / Timesheet</div>
                  </div>
                  <div className="text-right text-gray-600">
                    <div>Job: <span className="font-medium">{pdfDataSource.jobNumber || "—"}</span></div>
                    <div>Date: {pdfDataSource.date}</div>
                  </div>
                </div>
                <hr className="my-3" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-gray-600">Client</div>
                    <div className="font-medium">{pdfDataSource.client || "—"}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Site</div>
                    <div className="font-medium">{pdfDataSource.site || "—"}</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 mt-2">
                  <div><div className="text-gray-600">Start</div><div className="font-medium">{pdfDataSource.start}</div></div>
                  <div><div className="text-gray-600">Finish</div><div className="font-medium">{pdfDataSource.finish}</div></div>
                  <div><div className="text-gray-600">Break (min)</div><div className="font-medium">{pdfDataSource.breakMin}</div></div>
                  <div><div className="text-gray-600">Hours</div><div className="font-medium">{pdfDataSource.hours || "—"}</div></div>
                </div>
                <div className="mt-3">
                  <div className="text-gray-600">Work Description</div>
                  <div className="font-medium whitespace-pre-wrap min-h-[64px]">{pdfDataSource.description || "—"}</div>
                </div>
                {pdfDataSource.materials && (
                  <div className="mt-3">
                    <div className="text-gray-600">Materials / Extras</div>
                    <div className="font-medium whitespace-pre-wrap">{pdfDataSource.materials}</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div><div className="text-gray-600">Employee</div><div className="font-medium">{pdfDataSource.employee || "—"}</div></div>
                  <div><div className="text-gray-600">Client Name</div><div className="font-medium">{pdfDataSource.clientName || "—"}</div></div>
                </div>
                <div className="mt-3">
                  <div className="text-gray-600 mb-1">Client Signature</div>
                  <div className="border rounded-xl p-2 h-32 flex items-center justify-center bg-white">
                    {clientSignature ? (<img src={clientSignature} alt="Signature" className="max-h-28 object-contain" />) : (<div className="text-gray-400 text-sm flex items-center gap-2"><Check className="w-4 h-4"/> Awaiting signature…</div>)}
                  </div>
                </div>
                <div className="text-[10px] text-gray-500 mt-2">
                  {isSealed ? (
                    <>Sealed at {new Date(sealedAt).toLocaleString()} • Verification ID: <span className="font-mono">{verificationId.slice(0,16)}</span><br/>By signing, the client confirms the above work was completed satisfactorily and authorises invoicing.</>
                  ) : (
                    <>By signing, the client confirms the above work was completed satisfactorily and authorises invoicing.
 Form locks automatically after signature.</>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-xs text-gray-500">
          Tip: Emails are remembered on this device only. To auto-send PDFs without opening your mail app, sign in with Outlook using the button above.
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700">{label} {required && <span className="text-red-500">*</span>}</span>
      {children}
    </label>
  );
}
