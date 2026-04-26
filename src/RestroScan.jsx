import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const DIRECT_API_BASE = "http://127.0.0.1:8000";

async function apiRequest(path, options = {}) {
 const { headers: customHeaders = {}, ...restOptions } = options;
 let response;
 try {
  response = await fetch(`${API_BASE}${path}`, {
   ...restOptions,
   headers: { "Content-Type": "application/json", ...customHeaders },
  });
 } catch (err) {
  try {
   response = await fetch(`${DIRECT_API_BASE}${path}`, {
    ...restOptions,
    headers: { "Content-Type": "application/json", ...customHeaders },
   });
  } catch (_fallbackErr) {
   throw new Error(`Cannot reach backend API. Tried ${API_BASE}${path} and ${DIRECT_API_BASE}${path}.`);
  }
 }

 if (!response.ok) {
  const payload = await response.json().catch(() => null);
  const text = payload ? "" : await response.text().catch(() => "");
  if (response.status === 500 && !payload?.detail && !text.trim()) {
   throw new Error("Backend API is not reachable. Start FastAPI at http://127.0.0.1:8000.");
  }
  let detail = payload?.detail || text?.slice(0, 140) || `HTTP ${response.status}`;
  if (Array.isArray(detail)) {
   detail = detail
    .map((entry) => {
     const pathText = Array.isArray(entry?.loc) ? entry.loc.join(".") : "field";
     return `${pathText}: ${entry?.msg || "Invalid value"}`;
    })
    .join("; ");
  } else if (detail && typeof detail === "object") {
   detail = JSON.stringify(detail);
  }
  if (response.status === 401 && String(detail).toLowerCase().includes("invalid token")) {
   throw new Error("Session expired. Please login again.");
  }
  throw new Error(`API ${response.status}: ${detail}`);
 }

 if (response.status === 204) {
  return null;
 }

 return response.json();
}

function buildReceiptData(invoice) {
 const now = new Date();
 const restaurantName = invoice.restaurantName || "Restaurant";
 const invoiceNo = invoice.invoiceNo || `INV-${now.getFullYear()}-${String(invoice.billId).padStart(4, "0")}`;
 const customerName = invoice.customerName || "Walk-in Guest";
 const paymentMode = invoice.paymentMode || "CARD";
 const subtotal = Number(invoice.total || 0);
 const gst = Number(invoice.tax || 0);
 const cgst = gst / 2;
 const sgst = gst / 2;
 const total = Number(invoice.final || 0);
 const dateLabel = now.toLocaleDateString("en-GB");
 const timeLabel = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
 return { restaurantName, invoiceNo, customerName, paymentMode, subtotal, gst, cgst, sgst, total, dateLabel, timeLabel };
}

function fitText(text, width = 30) {
 const t = String(text || "");
 return t.length > width ? `${t.slice(0, width - 1)}.` : t;
}

function lineWithAmount(left, right, width = 34) {
 const l = String(left || "");
 const r = String(right || "");
 const spaces = Math.max(1, width - l.length - r.length);
 return `${l}${" ".repeat(spaces)}${r}`;
}

function centerText(text, width = 34) {
 const t = String(text || "");
 if (t.length >= width) return t;
 const pad = Math.floor((width - t.length) / 2);
 return `${" ".repeat(pad)}${t}`;
}

function buildBillText(invoice) {
 const d = buildReceiptData(invoice);
 const rows = [
  centerText(d.restaurantName.toUpperCase()),
  centerText("INVOICE"),
  lineWithAmount("Date:", d.dateLabel),
  lineWithAmount("Time:", d.timeLabel),
  lineWithAmount("Table:", String(invoice.tableLabel || "-")),
  "-".repeat(34),
  lineWithAmount("RECEIPT NO", d.invoiceNo),
  lineWithAmount("CUSTOMER", fitText(d.customerName, 18)),
  lineWithAmount("PAYMENT", d.paymentMode),
  lineWithAmount("MODE", "ONLINE"),
  "-".repeat(34),
  ...invoice.items.map((item) => {
   const qty = Number(item.quantity || 0);
   const name = fitText(item.item_name || "Item", 20);
   const amount = `Rs${(qty * Number(item.price || 0)).toFixed(2)}`;
   return lineWithAmount(`${qty} x ${name}`, amount);
  }),
  "-".repeat(34),
  lineWithAmount("SUBTOTAL", `Rs${d.subtotal.toFixed(2)}`),
  lineWithAmount("CGST (2.5%)", `Rs${d.cgst.toFixed(2)}`),
  lineWithAmount("SGST (2.5%)", `Rs${d.sgst.toFixed(2)}`),
  lineWithAmount("TOTAL", `Rs${d.total.toFixed(2)}`),
  "",
  centerText("THANK YOU. VISIT AGAIN."),
  centerText("THANK YOU"),
 ];
 return rows.join("\n");
}

function openInvoicePrintWindow(invoice) {
 const d = buildReceiptData(invoice);
 const receiptText = buildBillText(invoice);
 const html = `<!doctype html>
<html>
 <head>
  <meta charset="utf-8" />
  <title>${d.invoiceNo}</title>
  <style>
   @page { size: 80mm auto; margin: 4mm; }
   body { font-family: 'Courier New', monospace; margin: 0; color: #111; background: #fff; }
   .wrap { width: 72mm; margin: 0 auto; border: 1px dashed #999; padding: 2mm; box-sizing: border-box; }
   pre { margin: 0; font-size: 12px; line-height: 1.45; white-space: pre; }
   @media print {
    .no-print { display: none; }
    .wrap { border: none; padding: 0; width: 72mm; }
   }
  </style>
 </head>
 <body>
  <div class="wrap">
   <pre>${receiptText}</pre>
   <div class="no-print" style="margin-top:16px;">
    <button onclick="window.print()" style="padding:8px 12px;">Print / Save PDF</button>
   </div>
  </div>
 </body>
</html>`;

 const win = window.open("", "_blank", "width=840,height=900");
 if (!win) return;
 win.document.open();
 win.document.write(html);
 win.document.close();
}

function escapePdfText(text) {
 return String(text || "")
  .replace(/\\/g, "\\\\")
  .replace(/\(/g, "\\(")
  .replace(/\)/g, "\\)");
}

function buildSimplePdf(lines) {
 const safeLines = (lines || []).map((line) => escapePdfText(line));
 const contentLines = [
  "BT",
  "/F1 10 Tf",
  "50 800 Td",
 ];

 safeLines.forEach((line, idx) => {
  if (idx > 0) contentLines.push("0 -13 Td");
  contentLines.push(`(${line}) Tj`);
 });
 contentLines.push("ET");

 const stream = contentLines.join("\n");

 const pageWidth = 226; // ~80mm
 const pageHeight = 900; // long receipt

 const objects = [
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
  "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
  `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
  `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n",
 ];

 let pdf = "%PDF-1.4\n";
 const offsets = [0];
 objects.forEach((obj) => {
  offsets.push(pdf.length);
  pdf += obj;
 });
 const xrefStart = pdf.length;
 pdf += `xref\n0 ${objects.length + 1}\n`;
 pdf += "0000000000 65535 f \n";
 for (let i = 1; i < offsets.length; i += 1) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
 }
 pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
 return pdf;
}

function downloadBillToDisk(invoice) {
 const lines = buildBillText(invoice).split("\n");

 const pdfContent = buildSimplePdf(lines);
 const blob = new Blob([pdfContent], { type: "application/pdf" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `bill-${invoice.billId}.pdf`;
 document.body.appendChild(a);
 a.click();
 a.remove();
 URL.revokeObjectURL(url);
}

function buildKOTText(kot) {
 const lines = [
  "KITCHEN ORDER TICKET",
  `Order: ${kot.orderLabel}`,
  `Table: ${kot.tableLabel}`,
  `Status: ${kot.status}`,
  `Time: ${kot.generatedAt}`,
  "",
  "Items:",
  ...kot.items.map((item, i) => `${i + 1}. ${item.item_name} x ${item.quantity}`),
  "",
  `Total Items: ${kot.items.reduce((sum, x) => sum + Number(x.quantity || 0), 0)}`,
 ];
 return lines.join("\n");
}

function openKOTPrintWindow(kot) {
 const html = `<!doctype html>
<html>
 <head>
  <meta charset="utf-8" />
  <title>KOT ${kot.orderLabel}</title>
  <style>
   body { font-family: monospace; margin: 24px; color: #111; }
   .ticket { width: 360px; border: 1px dashed #999; padding: 14px; }
   h1 { margin: 0 0 8px; font-size: 18px; text-align: center; }
   .meta { font-size: 12px; margin-bottom: 10px; }
   .item { display: flex; justify-content: space-between; font-size: 13px; border-bottom: 1px dotted #ddd; padding: 5px 0; }
   .total { margin-top: 10px; font-weight: bold; font-size: 13px; }
   @media print { .no-print { display: none; } }
  </style>
 </head>
 <body>
  <div class="ticket">
   <h1>KITCHEN ORDER TICKET</h1>
   <div class="meta">Order: ${kot.orderLabel}<br/>Table: ${kot.tableLabel}<br/>Status: ${kot.status}<br/>Printed: ${kot.generatedAt}</div>
   ${kot.items.map((item) => `<div class="item"><span>${item.item_name}</span><strong>x${item.quantity}</strong></div>`).join("")}
   <div class="total">Total Items: ${kot.items.reduce((sum, x) => sum + Number(x.quantity || 0), 0)}</div>
   <div class="no-print" style="margin-top:12px;"><button onclick="window.print()">Print / Save PDF</button></div>
  </div>
 </body>
</html>`;
 const win = window.open("", "_blank", "width=520,height=900");
 if (!win) return;
 win.document.open();
 win.document.write(html);
 win.document.close();
}

function downloadKOTToDisk(kot) {
 const text = buildKOTText(kot);
 const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `kot-${kot.orderLabel}.txt`;
 document.body.appendChild(a);
 a.click();
 a.remove();
 URL.revokeObjectURL(url);
}

const initialOrders = [
 { id: "ORD-1024", table: "T-05", guests: 4, items: "Chicken Biryani 2, Naan, Lassi", amount: 32.47, status: "Preparing", time: "2:32 PM", category: "Non-Veg" },
 { id: "ORD-1023", table: "T-02", guests: 2, items: "Paneer Masala, Rice, Roti", amount: 26.46, status: "Completed", time: "2:28 PM", category: "Veg" },
 { id: "ORD-1022", table: "T-08", guests: 5, items: "3x Veg Burger, Fries, 2x Coffee", amount: 30.96, status: "New", time: "2:25 PM", category: "Veg" },
 { id: "ORD-1021", table: "T-01", guests: 3, items: "Chicken Curry, 2x Naan, Lassi", amount: 24.49, status: "Completed", time: "2:20 PM", category: "Non-Veg" },
 { id: "ORD-1020", table: "T-06", guests: 6, items: "Dal Makhani, Butter Naan, Raita", amount: 28.75, status: "Completed", time: "2:15 PM", category: "Veg" },
 { id: "ORD-1019", table: "T-03", guests: 2, items: "Margherita Pizza, Coke x2", amount: 19.99, status: "Completed", time: "2:10 PM", category: "Veg" },
];

const initialTables = [
 { id: "T-01", status: "Dining", amount: 24.49, guests: 3, order: "ORD-1021" },
 { id: "T-02", status: "Preparing", amount: 26.46, guests: 2, order: "ORD-1023" },
 { id: "T-03", status: "Available", amount: 0, guests: 0, order: null },
 { id: "T-04", status: "Reserved", amount: 0, guests: 0, order: null },
 { id: "T-05", status: "Dining", amount: 18.99, guests: 4, order: "ORD-1024" },
 { id: "T-06", status: "Dining", amount: 28.75, guests: 6, order: "ORD-1020" },
 { id: "T-07", status: "Available", amount: 0, guests: 0, order: null },
 { id: "T-08", status: "Preparing", amount: 30.96, guests: 5, order: "ORD-1022" },
 { id: "T-09", status: "Available", amount: 0, guests: 0, order: null },
 { id: "T-10", status: "Reserved", amount: 0, guests: 0, order: null },
 { id: "T-11", status: "Available", amount: 0, guests: 0, order: null },
 { id: "T-12", status: "Available", amount: 0, guests: 0, order: null },
];

const menuItemsData = [
 { id: 1, name: "Chicken Biryani", category: "Main Course", price: 12.99, available: true, veg: false, orders: 45 },
 { id: 2, name: "Paneer Masala", category: "Main Course", price: 10.99, available: true, veg: true, orders: 32 },
 { id: 3, name: "Veg Burger", category: "Fast Food", price: 6.99, available: true, veg: true, orders: 28 },
 { id: 4, name: "Dal Makhani", category: "Main Course", price: 9.99, available: true, veg: true, orders: 40 },
 { id: 5, name: "Margherita Pizza", category: "Pizza", price: 11.99, available: false, veg: true, orders: 22 },
 { id: 6, name: "Chicken Curry", category: "Main Course", price: 11.49, available: true, veg: false, orders: 38 },
 { id: 7, name: "Butter Naan", category: "Breads", price: 1.99, available: true, veg: true, orders: 85 },
 { id: 8, name: "Lassi", category: "Beverages", price: 2.99, available: true, veg: true, orders: 60 },
];

const staffData = [
 { id: 1, name: "Amit Sharma", role: "Chef", status: "Active", shift: "Morning", orders: 12 },
 { id: 2, name: "Priya Singh", role: "Waiter", status: "Active", shift: "Morning", orders: 8 },
 { id: 3, name: "Ravi Kumar", role: "Waiter", status: "Break", shift: "Afternoon", orders: 5 },
 { id: 4, name: "Sunita Rao", role: "Cashier", status: "Active", shift: "Morning", orders: 32 },
 { id: 5, name: "Deepak Verma", role: "Chef", status: "Active", shift: "Afternoon", orders: 9 },
];

const categories = ["All", "Main Course", "Fast Food", "Pizza", "Breads", "Beverages"];

const statusColors = {
 Preparing: { bg: "#fff3e0", color: "#e65100", dot: "#ff6d00" },
 Completed: { bg: "#e8f5e9", color: "#2e7d32", dot: "#43a047" },
 New: { bg: "#e3f2fd", color: "#1565c0", dot: "#1e88e5" },
 Dining: { bg: "#fff8e1", color: "#f57f17", dot: "#ffa000" },
 Available: { bg: "#e8f5e9", color: "#2e7d32", dot: "#43a047" },
 Reserved: { bg: "#fce4ec", color: "#880e4f", dot: "#e91e63" },
 Active: { bg: "#e8f5e9", color: "#2e7d32", dot: "#43a047" },
 Break: { bg: "#fff3e0", color: "#e65100", dot: "#ff6d00" },
};

const Badge = ({ status }) => {
 const s = statusColors[status] || { bg: "#f5f5f5", color: "#333", dot: "#999" };
 return (
  <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
   <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
   {status}
  </span>
 );
};

const Modal = ({ title, onClose, children }) => (
 <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
  <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 480, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
   <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>{title}</h2>
    <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#666", lineHeight: 1 }}></button>
   </div>
   {children}
  </div>
 </div>
);

const Input = ({ label, ...props }) => (
 <div style={{ marginBottom: 14 }}>
  {label && <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>{label}</label>}
  <input {...props} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box", transition: "border 0.2s", ...props.style }} onFocus={e => e.target.style.borderColor = "#ff6b35"} onBlur={e => e.target.style.borderColor = "#e0e0e0"} />
 </div>
);

const Select = ({ label, children, ...props }) => (
 <div style={{ marginBottom: 14 }}>
  {label && <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>{label}</label>}
  <select {...props} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 14, outline: "none", background: "#fff", boxSizing: "border-box" }}>
   {children}
  </select>
 </div>
);

const Btn = ({ children, variant = "primary", style: s, ...props }) => {
 const styles = {
  primary: { background: "#ff6b35", color: "#fff", border: "none" },
  secondary: { background: "#fff", color: "#ff6b35", border: "1.5px solid #ff6b35" },
  ghost: { background: "#f5f5f5", color: "#333", border: "none" },
  danger: { background: "#d32f2f", color: "#fff", border: "none" },
  green: { background: "#2e7d32", color: "#fff", border: "none" },
 };
 return (
  <button {...props} style={{ padding: "9px 18px", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, transition: "opacity 0.15s", ...styles[variant], ...s }}>
   {children}
  </button>
 );
};

// PAGES 

function Dashboard({ orders, setOrders, tables, setTables, setPage, setModal, menuItems }) {
 const totalOrders = orders.length;
 const completedOrders = orders.filter((o) => o.status === "Completed");
 const revenue = completedOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
 const pendingBills = orders.filter(o => o.status !== "Completed").reduce((a, b) => a + Number(b.amount || 0), 0);
 const activeTables = tables.filter(t => t.status === "Dining" || t.status === "Preparing" || t.status === "Reserved").length;

 return (
  <div>
   <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1a1a1a" }}>Dashboard Overview</h1>
     <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>Welcome back! Here's what's happening at your restaurant.</p>
    </div>
    <div style={{ display: "flex", gap: 10 }}>
     <Btn variant="ghost"> Today</Btn>
     <Btn variant="ghost"> Export</Btn>
     <Btn onClick={() => setModal("quickbill")}>+ Quick Bill</Btn>
    </div>
   </div>

   {/* Stats */}
   <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
    {[
     { icon: "", label: "Total Orders", value: totalOrders, sub: `${orders.filter(o => o.status === "New").length} new orders`, subColor: "#43a047", bg: "#fff3e0", iconBg: "#ff6b35" },
     { icon: "", label: "Revenue", value: `$${revenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, sub: `${completedOrders.length} completed orders`, subColor: "#43a047", bg: "#e8f5e9", iconBg: "#43a047" },
     { icon: "", label: "Pending Bills", value: `$${pendingBills.toFixed(2)}`, sub: `${orders.filter(o => o.status !== "Completed").length} active orders`, subColor: "#f57f17", bg: "#fff8e1", iconBg: "#f57f17" },
     { icon: "", label: "Active Tables", value: `${activeTables} / ${tables.length || 0}`, sub: `${tables.length ? Math.round(activeTables / tables.length * 100) : 0}% occupied`, subColor: "#1e88e5", bg: "#e3f2fd", iconBg: "#1e88e5" },
    ].map(c => (
     <div key={c.label} style={{ background: "#fff", borderRadius: 14, padding: "20px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", display: "flex", alignItems: "flex-start", gap: 14 }}>
      <div style={{ width: 50, height: 50, borderRadius: 14, background: c.iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{c.icon}</div>
      <div>
       <div style={{ fontSize: 12, color: "#888", marginBottom: 3 }}>{c.label}</div>
       <div style={{ fontSize: 22, fontWeight: 800, color: "#1a1a1a", marginBottom: 2 }}>{c.value}</div>
       <div style={{ fontSize: 12, color: c.subColor, fontWeight: 600 }}>{c.sub}</div>
      </div>
     </div>
    ))}
   </div>

   {/* Mid row */}
   <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
    {/* Kitchen */}
    <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
     <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
       <span style={{ fontSize: 18 }}></span>
       <span style={{ fontWeight: 700, fontSize: 15 }}>Kitchen Module</span>
      </div>
      <span style={{ background: "#e8f5e9", color: "#2e7d32", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>3 New</span>
     </div>
     <div style={{ fontSize: 12, color: "#e65100", marginBottom: 14 }}> Live orders {orders.filter(o => o.status === "Preparing").length} preparing {orders.filter(o => o.status === "New").length} pending</div>
     <Btn style={{ width: "100%", justifyContent: "center", marginBottom: 8 }} onClick={() => setPage("kitchen")}> Open Kitchen Display</Btn>
     <Btn variant="ghost" style={{ width: "100%", justifyContent: "center" }} onClick={() => setPage("orders")}> View All ->Orders</Btn>
    </div>

    {/* Menu */}
    <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
     <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 18 }}></span>
      <span style={{ fontWeight: 700, fontSize: 15 }}>Menu Management</span>
     </div>
     <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}> {menuItems.length} items 6 categories</div>
     <Btn variant="ghost" style={{ width: "100%", justifyContent: "center", marginBottom: 8 }} onClick={() => setPage("menu")}> Manage Menu</Btn>
     <Btn variant="secondary" style={{ width: "100%", justifyContent: "center" }} onClick={() => setModal("addmenu")}>+ Add New Item</Btn>
    </div>

    {/* Table Status */}
    <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
     <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
      <span style={{ fontWeight: 700, fontSize: 15 }}>Table Status</span>
      <button onClick={() => setPage("tables")} style={{ background: "none", border: "none", color: "#ff6b35", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>View Layout -></button>
     </div>
     <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {tables.slice(0, 5).map(t => (
       <div key={t.id} style={{ border: "1.5px solid #f0f0f0", borderRadius: 10, padding: "8px 10px" }}>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 3 }}> {t.id}</div>
        {t.amount > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>${t.amount}</div>}
        <Badge status={t.status} />
       </div>
      ))}
      <div style={{ border: "1.5px solid #f0f0f0", borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
       <button onClick={() => setPage("tables")} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+{tables.length - 5} more tables</button>
      </div>
     </div>
    </div>
   </div>

   {/* Bottom row */}
   <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
    {/* Recent Orders */}
    <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
     <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
      <span style={{ fontWeight: 700, fontSize: 15 }}>Recent Orders</span>
      <button onClick={() => setPage("orders")} style={{ background: "none", border: "none", color: "#ff6b35", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>View All -></button>
     </div>
     <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
       <tr style={{ borderBottom: "1.5px solid #f0f0f0" }}>
        {["Order", "Table", "Items", "Amount", "Status"].map(h => (
         <th key={h} style={{ textAlign: "left", padding: "8px 6px", fontSize: 12, color: "#888", fontWeight: 600 }}>{h}</th>
        ))}
       </tr>
      </thead>
      <tbody>
       {orders.slice(0, 4).map(o => (
        <tr key={o.id} style={{ borderBottom: "1px solid #fafafa" }}>
         <td style={{ padding: "10px 6px" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1a1a1a" }}>#{o.id}</div>
          <div style={{ fontSize: 11, color: "#aaa" }}>{o.time}</div>
         </td>
         <td style={{ padding: "10px 6px" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{o.table}</div>
          <div style={{ fontSize: 11, color: "#aaa" }}>{o.guests} guests</div>
         </td>
         <td style={{ padding: "10px 6px", fontSize: 12, color: "#555", maxWidth: 160 }}>{o.items}</td>
         <td style={{ padding: "10px 6px", fontWeight: 700, fontSize: 13 }}>${o.amount.toFixed(2)}</td>
         <td style={{ padding: "10px 6px" }}><Badge status={o.status} /></td>
        </tr>
      ))}
       {orders.length === 0 && (
        <tr>
         <td colSpan={5} style={{ padding: "14px 6px", fontSize: 12, color: "#888", textAlign: "center" }}>No orders yet.</td>
        </tr>
       )}
      </tbody>
     </table>
    </div>

    {/* Payment Summary + Quick Actions */}
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
     <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
       <span style={{ fontWeight: 700, fontSize: 15 }}>Payment Summary</span>
       <span style={{ fontSize: 12, color: "#888" }}>Today </span>
      </div>
      {[
       { icon: "", label: "Cash", sub: "32 orders", value: "$1,247.00", pct: 45, color: "#43a047" },
       { icon: "", label: "Card", sub: "28 orders", value: "$1,856.50", pct: 48, color: "#1e88e5" },
       { icon: "", label: "UPI", sub: "15 orders", value: "$744.00", pct: 7, color: "#9c27b0" },
      ].map(p => (
       <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span>{p.icon}</span>
        <div style={{ flex: 1 }}>
         <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
         <div style={{ fontSize: 11, color: "#aaa" }}>{p.sub}</div>
        </div>
        <div style={{ textAlign: "right" }}>
         <div style={{ fontSize: 13, fontWeight: 700 }}>{p.value}</div>
         <span style={{ background: p.color, color: "#fff", borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{p.pct}%</span>
        </div>
       </div>
      ))}
      <div style={{ borderTop: "1.5px solid #f0f0f0", marginTop: 8, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
       <span style={{ fontWeight: 700 }}>Total Revenue</span>
       <span style={{ fontWeight: 800, fontSize: 16, color: "#ff6b35" }}>${revenue.toFixed(2)}</span>
      </div>
     </div>

     <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Quick Actions</div>
      <div style={{ display: "flex", gap: 10, justifyContent: "space-around" }}>
       {[
        { icon: "", label: "Generate Bill", action: () => setModal("quickbill") },
        { icon: "", label: "Print KOT", action: () => setModal("printkot") },
        { icon: "", label: "Table QR", action: () => setModal("qrcode") },
       ].map(a => (
        <button key={a.label} onClick={a.action} style={{ background: "none", border: "1.5px solid #f0f0f0", borderRadius: 12, padding: "12px 10px", cursor: "pointer", textAlign: "center", flex: 1, transition: "all 0.15s" }} onMouseOver={e => e.currentTarget.style.borderColor = "#ff6b35"} onMouseOut={e => e.currentTarget.style.borderColor = "#f0f0f0"}>
         <div style={{ fontSize: 22, marginBottom: 4 }}>{a.icon}</div>
         <div style={{ fontSize: 11, color: "#555", fontWeight: 600 }}>{a.label}</div>
        </button>
       ))}
      </div>
     </div>
    </div>
   </div>
  </div>
 );
}

function KitchenModule({ orders, onUpdateOrderStatus }) {
 const [statusFilter, setStatusFilter] = useState("All");
 const [dateFilter, setDateFilter] = useState("Today");
 const [customDate, setCustomDate] = useState(new Date().toISOString().slice(0, 10));

 const isSameDate = (a, b) => (
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate()
 );

 const matchesDateFilter = (order) => {
  if (dateFilter === "All Dates") return true;
  const orderDate = order.created_at ? new Date(order.created_at) : null;
  if (!orderDate || Number.isNaN(orderDate.getTime())) return dateFilter === "Today";

  const now = new Date();
  if (dateFilter === "Today") return isSameDate(orderDate, now);
  if (dateFilter === "Yesterday") {
   const yesterday = new Date(now);
   yesterday.setDate(now.getDate() - 1);
   return isSameDate(orderDate, yesterday);
  }
  if (dateFilter === "Custom Date" && customDate) {
   const [y, m, d] = customDate.split("-").map((x) => parseInt(x, 10));
   if (!y || !m || !d) return true;
   return (
    orderDate.getFullYear() === y
    && (orderDate.getMonth() + 1) === m
    && orderDate.getDate() === d
   );
  }
  return true;
 };

 const updateStatus = async (orderId, status) => {
  await onUpdateOrderStatus(orderId, status);
 };
 const filteredOrders = orders.filter((o) => {
  const statusOk = statusFilter === "All" ? true : o.status === statusFilter;
  return statusOk && matchesDateFilter(o);
 });
 const pending = filteredOrders.filter((o) => o.status !== "Completed");

 return (
  <div>
   <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Kitchen Display</h1>
     <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>{pending.length} active orders in queue</p>
    </div>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
     <select
      value={dateFilter}
      onChange={(e) => setDateFilter(e.target.value)}
      style={{ padding: "8px 10px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 12, background: "#fff" }}
     >
      {["Today", "Yesterday", "Custom Date", "All Dates"].map((d) => <option key={d}>{d}</option>)}
     </select>
     {dateFilter === "Custom Date" && (
      <input
       type="date"
       value={customDate}
       onChange={(e) => setCustomDate(e.target.value)}
       style={{ padding: "7px 10px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 12, background: "#fff" }}
      />
     )}
     {["All", "New", "Preparing", "Completed"].map(f => (
      <Btn
       key={f}
       variant={statusFilter === f ? "primary" : "ghost"}
       style={{ fontSize: 12 }}
       onClick={() => setStatusFilter(f)}
      >
       {f}
      </Btn>
     ))}
    </div>
   </div>
   <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
    {filteredOrders.map(o => (
     <div key={o.id} style={{ background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", borderTop: `4px solid ${o.status === "New" ? "#1e88e5" : o.status === "Preparing" ? "#ff6b35" : "#43a047"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
       <div>
        <div style={{ fontWeight: 800, fontSize: 15 }}>#{o.id}</div>
        <div style={{ fontSize: 12, color: "#888" }}>{o.time} {o.table} {o.guests} guests</div>
       </div>
       <Badge status={o.status} />
      </div>
      <div style={{ borderTop: "1px solid #f5f5f5", paddingTop: 10, marginBottom: 12 }}>
       {o.items.split(",").map((item, i) => (
        <div key={i} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px dashed #f0f0f0", color: "#333" }}> {item.trim()}</div>
       ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
       {o.status === "New" && <Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => updateStatus(o.order_id || parseInt(String(o.id).replace("ORD-", ""), 10), "Preparing")}> Start Preparing</Btn>}
       {o.status === "Preparing" && <Btn variant="green" style={{ flex: 1, justifyContent: "center" }} onClick={() => updateStatus(o.order_id || parseInt(String(o.id).replace("ORD-", ""), 10), "Completed")}> Mark Ready</Btn>}
       {o.status === "Completed" && <div style={{ flex: 1, textAlign: "center", color: "#43a047", fontWeight: 600, fontSize: 13 }}> Order Ready</div>}
      </div>
     </div>
    ))}
   </div>
   {filteredOrders.length === 0 && (
    <div style={{ marginTop: 16, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", color: "#777", fontSize: 13 }}>
     No orders found for selected status/date.
    </div>
   )}
  </div>
 );
}

function MenuPage({ setModal, menuItems, setMenuItems, onUpdateMenuItem }) {
 const [cat, setCat] = useState("All");
 const [search, setSearch] = useState("");
 const [editItem, setEditItem] = useState(null);
 const items = menuItems;
 const filtered = items.filter(i => (cat === "All" || i.category === cat) && i.name.toLowerCase().includes(search.toLowerCase()));

 return (
  <div>
   <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Menu Management</h1>
     <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>{items.length} items across 6 categories</p>
    </div>
    <Btn onClick={() => setModal("addmenu")}>+ Add New Item</Btn>
   </div>
   <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
    <input value={search} onChange={e => setSearch(e.target.value)} placeholder=" Search items..." style={{ padding: "8px 14px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 13, outline: "none", minWidth: 200 }} />
    {categories.map(c => (
     <button key={c} onClick={() => setCat(c)} style={{ padding: "8px 14px", border: "1.5px solid", borderColor: cat === c ? "#ff6b35" : "#e0e0e0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: cat === c ? "#fff3ee" : "#fff", color: cat === c ? "#ff6b35" : "#555" }}>{c}</button>
    ))}
   </div>
   <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
     <thead style={{ background: "#fafafa" }}>
      <tr>
       {["Item", "Category", "Full Price", "Half Price", "Orders", "Available", "Actions"].map(h => (
        <th key={h} style={{ textAlign: "left", padding: "12px 16px", fontSize: 12, color: "#888", fontWeight: 700 }}>{h}</th>
       ))}
      </tr>
     </thead>
     <tbody>
      {filtered.map(item => (
       <tr key={item.id} style={{ borderTop: "1px solid #f5f5f5" }}>
        <td style={{ padding: "12px 16px" }}>
         <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: item.veg ? "#43a047" : "#e53935", display: "inline-block" }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</span>
         </div>
        </td>
        <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>{item.category}</td>
        <td style={{ padding: "12px 16px", fontWeight: 700, fontSize: 14 }}>${item.price.toFixed(2)}</td>
        <td style={{ padding: "12px 16px", fontWeight: 700, fontSize: 14 }}>{item.half_price != null ? `$${Number(item.half_price).toFixed(2)}` : "-"}</td>
        <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>{item.orders}</td>
        <td style={{ padding: "12px 16px" }}>
         <div onClick={() => setMenuItems(prev => prev.map(i => i.id === item.id ? { ...i, available: !i.available } : i))} style={{ width: 40, height: 22, borderRadius: 11, background: item.available ? "#ff6b35" : "#e0e0e0", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: item.available ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
         </div>
        </td>
        <td style={{ padding: "12px 16px" }}>
         <div style={{ display: "flex", gap: 6 }}>
          <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setEditItem(item)}> Edit</Btn>
          <Btn variant="danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setMenuItems(prev => prev.filter(i => i.id !== item.id))}></Btn>
         </div>
        </td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>
   {editItem && (
    <AddMenuModal
     title="Edit Menu Item"
     initialForm={{
      name: editItem.name || "",
      category: editItem.category || "Main Course",
      fullPrice: editItem.price != null ? String(editItem.price) : "",
      halfPrice: editItem.half_price != null ? String(editItem.half_price) : "",
      veg: !!editItem.veg,
     }}
     onClose={() => setEditItem(null)}
     onAdd={async (form) => {
      await onUpdateMenuItem(editItem.id, form);
      setEditItem(null);
     }}
    />
   )}
  </div>
 );
}

function TablesPage({ tables, setTables, onAddTables, onUpdateTableStatus }) {
 const updateTable = async (tableId, uiId, status) => {
  setTables((prev) => prev.map((t) => (t.id === uiId ? { ...t, status } : t)));
  try {
   await onUpdateTableStatus(tableId, status);
  } catch (_err) {
   // Rollback by reloading dashboard in parent handler
  }
 };
 const statusOpts = ["Available", "Dining", "Reserved", "Preparing"];
 const [showAdd, setShowAdd] = useState(false);
 const [tableCount, setTableCount] = useState("1");
 const [adding, setAdding] = useState(false);
 const [addError, setAddError] = useState("");

 return (
  <div>
   <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Table Management</h1>
     <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>{tables.length} tables {tables.filter(t => t.status === "Dining" || t.status === "Preparing").length} occupied</p>
    </div>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
     <Btn onClick={() => setShowAdd(true)}>+ Add Table</Btn>
     {Object.entries({ "Available": "#43a047", "Dining": "#ffa000", "Preparing": "#ff6b35", "Reserved": "#e91e63" }).map(([k]) => (
      <span key={k} style={{ fontSize: 12, padding: "5px 12px", background: "#f5f5f5", borderRadius: 20, color: "#555" }}>{k}</span>
     ))}
    </div>
   </div>

   {showAdd && (
    <Modal title="Add New Tables" onClose={() => setShowAdd(false)}>
     <Input label="How many tables to add?" type="number" min={1} max={50} value={tableCount} onChange={(e) => setTableCount(e.target.value)} />
     {addError && <div style={{ color: "#d32f2f", fontSize: 12, marginBottom: 10 }}>{addError}</div>}
     <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
      <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
      <Btn
       onClick={async () => {
        const count = Math.max(1, Math.min(50, parseInt(tableCount || "1", 10) || 1));
        setAdding(true);
        setAddError("");
        try {
         await onAddTables(count);
         setShowAdd(false);
         setTableCount("1");
        } catch (err) {
         setAddError(err.message || "Failed to add tables");
        } finally {
         setAdding(false);
        }
       }}
       disabled={adding}
      >
       {adding ? "Adding..." : "Add Tables"}
      </Btn>
     </div>
    </Modal>
   )}

   <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
    {tables.map(t => (
     <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", borderLeft: `4px solid ${statusColors[t.status]?.dot || "#999"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
       <span style={{ fontWeight: 800, fontSize: 16 }}>{t.id}</span>
       <Badge status={t.status} />
      </div>
      {t.guests > 0 && <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Guests: {t.guests}</div>}
      {t.amount > 0 && <div style={{ fontSize: 18, fontWeight: 800, color: "#ff6b35", marginBottom: 10 }}>${t.amount.toFixed(2)}</div>}
      {t.order && <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10 }}>#{t.order}</div>}
      <select value={t.status} onChange={e => updateTable(t.table_id, t.id, e.target.value)} style={{ width: "100%", padding: "6px 10px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 12, outline: "none", background: "#fff" }}>
       {statusOpts.map(s => <option key={s}>{s}</option>)}
      </select>
     </div>
    ))}
   </div>
  </div>
 );
}
function OrdersPage({ orders, onUpdateOrderStatus }) {
 const [filter, setFilter] = useState("All");
 const [search, setSearch] = useState("");
 const filtered = orders.filter(o => (filter === "All" || o.status === filter) && (o.id.toLowerCase().includes(search.toLowerCase()) || o.table.toLowerCase().includes(search.toLowerCase())));

 return (
  <div>
   <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Order History</h1>
     <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>{orders.length} orders today</p>
    </div>
   </div>
   <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
    <input value={search} onChange={e => setSearch(e.target.value)} placeholder=" Search orders..." style={{ padding: "8px 14px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 13, outline: "none", minWidth: 200 }} />
    {["All", "New", "Preparing", "Completed"].map(f => (
     <button key={f} onClick={() => setFilter(f)} style={{ padding: "8px 14px", border: "1.5px solid", borderColor: filter === f ? "#ff6b35" : "#e0e0e0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: filter === f ? "#fff3ee" : "#fff", color: filter === f ? "#ff6b35" : "#555" }}>{f}</button>
    ))}
   </div>
   <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
     <thead style={{ background: "#fafafa" }}>
      <tr>
       {["Order ID", "Time", "Table", "Guests", "Items", "Amount", "Status", "Actions"].map(h => (
        <th key={h} style={{ textAlign: "left", padding: "12px 14px", fontSize: 12, color: "#888", fontWeight: 700 }}>{h}</th>
       ))}
      </tr>
     </thead>
     <tbody>
      {filtered.map(o => (
       <tr key={o.id} style={{ borderTop: "1px solid #f5f5f5" }}>
        <td style={{ padding: "12px 14px", fontWeight: 700, color: "#ff6b35" }}>#{o.id}</td>
        <td style={{ padding: "12px 14px", fontSize: 13, color: "#888" }}>{o.time}</td>
        <td style={{ padding: "12px 14px", fontWeight: 600 }}>{o.table}</td>
        <td style={{ padding: "12px 14px", fontSize: 13 }}>{o.guests}</td>
        <td style={{ padding: "12px 14px", fontSize: 12, color: "#555", maxWidth: 200 }}>{o.items}</td>
        <td style={{ padding: "12px 14px", fontWeight: 700 }}>${o.amount.toFixed(2)}</td>
        <td style={{ padding: "12px 14px" }}><Badge status={o.status} /></td>
        <td style={{ padding: "12px 14px" }}>
         <div style={{ display: "flex", gap: 6 }}>
          {o.status !== "Completed" && (
           <Btn variant="green" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onUpdateOrderStatus(o.order_id || parseInt(String(o.id).replace("ORD-", ""), 10), "Completed")}></Btn>
          )}
          <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => alert(`Bill for #${o.id}\n${o.items}\nTotal: $${o.amount.toFixed(2)}`)}> Bill</Btn>
         </div>
        </td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>
  </div>
 );
}

function BillingPage({ orders }) {
 const completed = orders.filter(o => o.status === "Completed");
 const total = completed.reduce((a, b) => a + b.amount, 0);
 return (
  <div>
   <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Billing & Payments</h1>
     <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>Today's billing summary</p>
    </div>
    <Btn onClick={() => window.print()}> Export Report</Btn>
   </div>
   <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
    {[
     { label: "Total Billed", value: `$${total.toFixed(2)}`, icon: "", color: "#ff6b35" },
     { label: "Completed Orders", value: completed.length, icon: "", color: "#43a047" },
     { label: "Avg Order Value", value: `$${completed.length ? (total / completed.length).toFixed(2) : "0.00"}`, icon: "", color: "#1e88e5" },
    ].map(c => (
     <div key={c.label} style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ fontSize: 28 }}>{c.icon}</div>
      <div>
       <div style={{ fontSize: 12, color: "#888" }}>{c.label}</div>
       <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{c.value}</div>
      </div>
     </div>
    ))}
   </div>
   <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden" }}>
    <div style={{ padding: "16px 20px", borderBottom: "1px solid #f5f5f5", fontWeight: 700, fontSize: 15 }}>Recent Transactions</div>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
     <thead style={{ background: "#fafafa" }}>
      <tr>
       {["Order", "Table", "Items", "Amount", "Payment", "Status"].map(h => (
        <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontSize: 12, color: "#888", fontWeight: 700 }}>{h}</th>
       ))}
      </tr>
     </thead>
     <tbody>
      {completed.map((o, i) => (
       <tr key={o.id} style={{ borderTop: "1px solid #f5f5f5" }}>
        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#ff6b35" }}>#{o.id}</td>
        <td style={{ padding: "12px 16px" }}>{o.table}</td>
        <td style={{ padding: "12px 16px", fontSize: 12, color: "#555" }}>{o.items}</td>
        <td style={{ padding: "12px 16px", fontWeight: 700 }}>${o.amount.toFixed(2)}</td>
        <td style={{ padding: "12px 16px", fontSize: 13 }}>{["Cash", "Card", "UPI"][i % 3]}</td>
        <td style={{ padding: "12px 16px" }}><Badge status="Completed" /></td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>
  </div>
 );
}

function StaffPage({ staff, setStaff, onCreateStaff }) {
 const [showAdd, setShowAdd] = useState(false);
 const [form, setForm] = useState({ name: "", email: "", password: "", role: "Waiter", shift: "Morning" });

 return (
  <div>
   <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Staff Management</h1>
     <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>{staff.length} staff members</p>
    </div>
    <Btn onClick={() => setShowAdd(true)}>+ Add Staff</Btn>
   </div>
   {showAdd && (
    <Modal title="Add Staff Member" onClose={() => setShowAdd(false)}>
     <Input label="Full Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Enter name" />
     <Input label="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="staff@restaurant.com" />
     <Input label="Password" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Minimum 6 characters" />
     <Select label="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
      {["Chef", "Waiter", "Cashier", "Manager"].map(r => <option key={r}>{r}</option>)}
     </Select>
     <Select label="Shift" value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}>
      {["Morning", "Afternoon", "Night"].map(s => <option key={s}>{s}</option>)}
     </Select>
     <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
      <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
      <Btn onClick={async () => {
       if (form.name && form.email && form.password) {
        await onCreateStaff(form);
        setShowAdd(false);
        setForm({ name: "", email: "", password: "", role: "Waiter", shift: "Morning" });
       }
      }}>Add Staff</Btn>
     </div>
    </Modal>
   )}
   <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
    {staff.map(s => (
     <div key={s.id} style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
       <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#ff6b35", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 18 }}>{s.name[0]}</div>
       <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
        <div style={{ fontSize: 12, color: "#888" }}>{s.role} {s.shift}</div>
       </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
       <div>
        <div style={{ fontSize: 11, color: "#aaa" }}>Orders today</div>
        <div style={{ fontWeight: 700 }}>{s.orders}</div>
       </div>
       <Badge status={s.status} />
       <Btn variant="danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setStaff(prev => prev.filter(x => x.id !== s.id))}>Remove</Btn>
      </div>
     </div>
    ))}
   </div>
  </div>
 );
}

function ProfileManagementPage({ profile, onSaveProfile }) {
 const [avatarPreview, setAvatarPreview] = useState(null);
 const avatarInputRef = useRef(null);
 const [form, setForm] = useState({
  firstName: "Rajesh",
  lastName: "Kumar",
  email: "admin@restroscan.com",
  mobile: "+91 98765 43210",
  gender: "Male",
  dob: "1992-08-16",
  address: "221 Business Park Road",
  city: "Bengaluru",
  state: "Karnataka",
  country: "India",
  postalCode: "560001",
  bio: "Operations-focused admin with 8+ years in restaurant technology and team management.",
  avatarImage: "",
 });
 const [security, setSecurity] = useState({ twoFactorEnabled: true });
 const [prefs, setPrefs] = useState({
  emailNotifications: true,
  smsNotifications: false,
 });
 const [errors, setErrors] = useState({});
 const [savedAt, setSavedAt] = useState("");
 const [saving, setSaving] = useState(false);
 const [saveError, setSaveError] = useState("");
 const [avatarError, setAvatarError] = useState("");

 const css = `
  .profile-shell { max-width: 1200px; margin: 0 auto; }
  .profile-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:18px; }
  .profile-title { margin:0; font-size:28px; font-weight:800; color:#0f172a; letter-spacing:-0.3px; }
  .profile-sub { margin:6px 0 0; color:#64748b; font-size:14px; }
  .profile-grid { display:grid; grid-template-columns: 320px 1fr; gap:18px; }
  .card { background:#fff; border:1px solid #eef2f7; border-radius:16px; box-shadow:0 6px 20px rgba(15,23,42,0.06); transition:transform .2s ease, box-shadow .2s ease; }
  .card:hover { transform:translateY(-1px); box-shadow:0 10px 26px rgba(15,23,42,0.08); }
  .card-pad { padding:20px; }
  .avatar { width:96px; height:96px; border-radius:999px; background:linear-gradient(135deg,#1d4ed8,#60a5fa); color:#fff; font-weight:800; font-size:32px; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; }
  .avatar-img { width:96px; height:96px; border-radius:999px; object-fit:cover; display:block; margin:0 auto 12px; }
  .status-badges { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; margin-top:8px; }
  .badge-ok { background:#e8f8ef; color:#166534; border-radius:999px; padding:4px 10px; font-size:12px; font-weight:700; }
  .badge-verify { background:#e7f0ff; color:#1d4ed8; border-radius:999px; padding:4px 10px; font-size:12px; font-weight:700; }
  .section-title { margin:0 0 14px; font-size:16px; font-weight:700; color:#0f172a; }
  .form-grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px 14px; }
  .field.full { grid-column:1 / -1; }
  .label { display:block; margin-bottom:6px; font-size:12px; font-weight:700; color:#475569; }
  .input, .select, .textarea { width:100%; border:1.5px solid #e2e8f0; border-radius:10px; padding:10px 12px; font-size:14px; color:#0f172a; background:#fff; outline:none; transition:border-color .2s ease, box-shadow .2s ease; box-sizing:border-box; }
  .textarea { min-height:90px; resize:vertical; }
  .input:focus, .select:focus, .textarea:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,0.14); }
  .validation { min-height:16px; margin-top:4px; font-size:11px; color:#94a3b8; }
  .validation.err { color:#dc2626; }
  .meta-list { display:grid; gap:8px; margin-top:10px; }
  .meta-row { display:flex; justify-content:space-between; gap:8px; font-size:13px; color:#475569; }
  .toggle-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #f1f5f9; }
  .toggle-row:last-child { border-bottom:0; }
  .toggle-btn { width:48px; height:28px; border-radius:999px; border:0; padding:2px; cursor:pointer; background:#cbd5e1; transition:background .2s ease; }
  .toggle-btn.on { background:#2563eb; }
  .toggle-dot { width:24px; height:24px; border-radius:999px; background:#fff; transition:transform .2s ease; transform:translateX(0); }
  .toggle-btn.on .toggle-dot { transform:translateX(20px); }
  .security-grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:12px; }
  .sticky-actions { position:sticky; bottom:0; z-index:10; background:rgba(248,250,252,0.92); backdrop-filter: blur(6px); border:1px solid #e2e8f0; border-radius:14px; margin-top:16px; padding:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .action-group { display:flex; gap:10px; }
  .btn-neutral { border:1px solid #dbe2ea; background:#fff; color:#0f172a; }
  .btn-primary { border:0; background:#2563eb; color:#fff; }
  .mini-note { font-size:12px; color:#64748b; }
  @media (max-width: 1024px) {
   .profile-grid { grid-template-columns: 1fr; }
   .security-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
   .profile-header { flex-direction:column; }
   .form-grid { grid-template-columns: 1fr; }
   .action-group { width:100%; flex-direction:column; }
   .action-group button { width:100%; }
   .sticky-actions { flex-direction:column; align-items:stretch; }
  }
 `;

 const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

 useEffect(() => {
  if (!profile) return;
  setForm({
   firstName: profile.first_name || "",
   lastName: profile.last_name || "",
   email: profile.email || "",
   mobile: profile.mobile || "",
   gender: profile.gender || "Male",
   dob: profile.dob || "",
   address: profile.address || "",
   city: profile.city || "",
   state: profile.state || "",
   country: profile.country || "",
   postalCode: profile.postal_code || "",
   bio: profile.bio || "",
   avatarImage: profile.avatar_image || "",
  });
  setAvatarPreview(profile.avatar_image || null);
  setPrefs({
   emailNotifications: profile.email_notifications ?? true,
   smsNotifications: profile.sms_notifications ?? false,
  });
 }, [profile]);
 const validate = () => {
  const nextErrors = {};
  if (!form.firstName.trim()) nextErrors.firstName = "First name is required";
  if (!form.lastName.trim()) nextErrors.lastName = "Last name is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) nextErrors.email = "Please enter a valid email";
  if (!form.mobile.trim()) nextErrors.mobile = "Mobile number is required";
  setErrors(nextErrors);
  return Object.keys(nextErrors).length === 0;
 };

 const onSave = async () => {
  if (!validate()) return;
  setSaving(true);
  setSaveError("");
  try {
   await onSaveProfile(form, prefs);
   setSavedAt(new Date().toLocaleString());
  } catch (err) {
   setSaveError(err.message || "Failed to save profile");
  } finally {
   setSaving(false);
  }
 };

 const onCancel = () => {
  setErrors({});
  setSecurity({
   twoFactorEnabled: true,
  });
 };

 const onAvatarChange = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
   setAvatarError("Please select a valid image file.");
   return;
  }
  if (file.size > 5 * 1024 * 1024) {
   setAvatarError("Image size should be less than 5 MB.");
   return;
  }
  setAvatarError("");
  const reader = new FileReader();
  reader.onload = () => {
   const imageData = String(reader.result);
   setAvatarPreview(imageData);
   setForm((prev) => ({ ...prev, avatarImage: imageData }));
  };
  reader.readAsDataURL(file);
 };

 const renderField = (key, label, type = "text", full = false) => (
  <div className={`field ${full ? "full" : ""}`}>
   <label className="label">{label}</label>
   <input className="input" type={type} value={form[key]} onChange={(e) => setField(key, e.target.value)} />
   <div className={`validation ${errors[key] ? "err" : ""}`}>{errors[key] || " "}</div>
  </div>
 );

 return (
  <div className="profile-shell">
   <style>{css}</style>
   <div className="profile-header">
    <div>
     <h1 className="profile-title">Profile Management</h1>
     <p className="profile-sub">Manage your admin identity, security preferences, and communication settings.</p>
    </div>
   </div>

   <div className="profile-grid">
    <div style={{ display: "grid", gap: 16 }}>
     <div className="card card-pad">
      <h3 className="section-title">Profile Overview</h3>
      {avatarPreview ? <img src={avatarPreview} className="avatar-img" alt="Profile" /> : <div className="avatar">{(form.firstName?.[0] || "A").toUpperCase()}</div>}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
       <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>{form.firstName} {form.lastName}</div>
       <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Admin</div>
      </div>
      <div style={{ textAlign: "center", fontSize: 13, color: "#475569", marginBottom: 10 }}>{form.bio || "No bio added yet."}</div>
      <div style={{ display: "grid", gap: 8 }}>
       <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onAvatarChange} />
       <button type="button" className="btn-neutral" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }} onClick={() => avatarInputRef.current?.click()}>
        Upload / Change Image
       </button>
       <div style={{ minHeight: 16, fontSize: 11, color: avatarError ? "#dc2626" : "#64748b" }}>
        {avatarError || "Choose image from your computer, then click Save Changes."}
       </div>
      </div>
      <div className="status-badges">
       <span className="badge-ok">Active</span>
       <span className="badge-verify">Verified</span>
      </div>
     </div>

     <div className="card card-pad">
      <h3 className="section-title">Account Details</h3>
      <div className="meta-list">
       <div className="meta-row"><span>Role</span><strong>Admin</strong></div>
       <div className="meta-row"><span>Last Login</span><strong>Today, 09:42 AM</strong></div>
       <div className="meta-row"><span>Status</span><strong>Active / Verified</strong></div>
      </div>
     </div>

     <div className="card card-pad">
      <h3 className="section-title">Notifications</h3>
      <div className="toggle-row">
       <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>Email Notifications</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>Receive security and activity emails.</div>
       </div>
       <button className={`toggle-btn ${prefs.emailNotifications ? "on" : ""}`} onClick={() => setPrefs((p) => ({ ...p, emailNotifications: !p.emailNotifications }))}>
        <span className="toggle-dot" />
       </button>
      </div>
      <div className="toggle-row">
       <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>SMS Notifications</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>Receive OTP and account alerts via SMS.</div>
       </div>
       <button className={`toggle-btn ${prefs.smsNotifications ? "on" : ""}`} onClick={() => setPrefs((p) => ({ ...p, smsNotifications: !p.smsNotifications }))}>
        <span className="toggle-dot" />
       </button>
      </div>
     </div>
    </div>

    <div style={{ display: "grid", gap: 16 }}>
     <div className="card card-pad">
      <h3 className="section-title">Editable Profile Information</h3>
      <div className="form-grid">
       {renderField("firstName", "First Name")}
       {renderField("lastName", "Last Name")}
       {renderField("email", "Email Address", "email")}
       {renderField("mobile", "Mobile Number")}
       <div className="field">
        <label className="label">Gender</label>
        <select className="select" value={form.gender} onChange={(e) => setField("gender", e.target.value)}>
         <option>Male</option>
         <option>Female</option>
         <option>Other</option>
        </select>
        <div className="validation"> </div>
       </div>
       {renderField("dob", "Date of Birth", "date")}
       {renderField("address", "Address", "text", true)}
       {renderField("city", "City")}
       {renderField("state", "State")}
       {renderField("country", "Country")}
       {renderField("postalCode", "Postal Code")}
       <div className="field full">
        <label className="label">About / Bio</label>
        <textarea className="textarea" value={form.bio} onChange={(e) => setField("bio", e.target.value)} />
        <div className="validation"> </div>
       </div>
      </div>
     </div>

     <div className="card card-pad">
      <h3 className="section-title" style={{ marginBottom: 12 }}>Security Settings</h3>
      <div className="toggle-row">
       <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>Two-Factor Authentication</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>Secure admin access with an extra verification step.</div>
       </div>
       <button className={`toggle-btn ${security.twoFactorEnabled ? "on" : ""}`} onClick={() => setSecurity((p) => ({ ...p, twoFactorEnabled: !p.twoFactorEnabled }))}>
        <span className="toggle-dot" />
       </button>
      </div>
     </div>
    </div>
   </div>

   <div className="sticky-actions">
    <div className="mini-note">{saveError ? saveError : (savedAt ? `Last saved: ${savedAt}` : "Changes are saved securely.")}</div>
    <div className="action-group">
     <button className="btn-neutral" style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }} onClick={onCancel}>Cancel</button>
     <button className="btn-primary" style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }} onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
    </div>
   </div>
  </div>
 );
}

function ChangePasswordPage({ setPage, onChangePassword }) {
 const [form, setForm] = useState({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
 });
 const [errors, setErrors] = useState({});
 const [saved, setSaved] = useState(false);
 const [submitting, setSubmitting] = useState(false);
 const [apiError, setApiError] = useState("");

 const validate = () => {
  const next = {};
  if (!form.currentPassword) next.currentPassword = "Current password is required";
  if (!form.newPassword || form.newPassword.length < 6) next.newPassword = "New password must be at least 6 characters";
  if (form.newPassword !== form.confirmPassword) next.confirmPassword = "Passwords do not match";
  setErrors(next);
  return Object.keys(next).length === 0;
 };

 const onSubmit = async () => {
  if (!validate()) return;
  setSubmitting(true);
  setApiError("");
  try {
   await onChangePassword(form.currentPassword, form.newPassword);
   setSaved(true);
   setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
   setTimeout(() => setSaved(false), 2500);
  } catch (err) {
   setApiError(err.message || "Failed to change password");
  } finally {
   setSubmitting(false);
  }
 };

 return (
  <div style={{ maxWidth: 760, margin: "0 auto" }}>
   <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#0f172a" }}>Change Password</h1>
     <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>Update your account password securely.</p>
    </div>
    <Btn variant="ghost" onClick={() => setPage("profile")}>Back to Profile</Btn>
   </div>

   <div style={{ background: "#fff", border: "1px solid #eef2f7", borderRadius: 16, padding: 20, boxShadow: "0 6px 20px rgba(15,23,42,0.06)" }}>
    <div style={{ display: "grid", gap: 12 }}>
     <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>Current Password</label>
      <input type="password" value={form.currentPassword} onChange={(e) => setForm((p) => ({ ...p, currentPassword: e.target.value }))} style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
      <div style={{ minHeight: 16, marginTop: 4, fontSize: 11, color: errors.currentPassword ? "#dc2626" : "#94a3b8" }}>{errors.currentPassword || " "}</div>
     </div>
     <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>New Password</label>
      <input type="password" value={form.newPassword} onChange={(e) => setForm((p) => ({ ...p, newPassword: e.target.value }))} style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
      <div style={{ minHeight: 16, marginTop: 4, fontSize: 11, color: errors.newPassword ? "#dc2626" : "#94a3b8" }}>{errors.newPassword || " "}</div>
     </div>
     <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}>Confirm Password</label>
      <input type="password" value={form.confirmPassword} onChange={(e) => setForm((p) => ({ ...p, confirmPassword: e.target.value }))} style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
      <div style={{ minHeight: 16, marginTop: 4, fontSize: 11, color: errors.confirmPassword ? "#dc2626" : "#94a3b8" }}>{errors.confirmPassword || " "}</div>
     </div>
    </div>

    {saved && <div style={{ marginTop: 8, color: "#166534", fontSize: 13, fontWeight: 700 }}>Password updated successfully.</div>}
    {apiError && <div style={{ marginTop: 8, color: "#dc2626", fontSize: 13, fontWeight: 700 }}>{apiError}</div>}

    <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
     <Btn variant="ghost" onClick={() => setForm({ currentPassword: "", newPassword: "", confirmPassword: "" })}>Cancel</Btn>
     <Btn onClick={onSubmit} disabled={submitting}>{submitting ? "Saving..." : "Save Password"}</Btn>
    </div>
   </div>
  </div>
 );
}

function SettingsPage({ settingsData, onSaveSettings }) {
 const [form, setForm] = useState({
  language: "English",
  timezone: "Asia/Kolkata",
  date_format: "DD/MM/YYYY",
  currency: "INR",
  desktop_notifications: true,
  order_alert_sound: true,
  daily_email_summary: false,
  weekly_report: true,
  weekly_report_day: "Monday",
  two_factor_required: false,
  session_timeout_minutes: 60,
  auto_logout_minutes: 30,
  low_stock_alert: true,
  low_stock_threshold: 10,
  auto_print_kot: false,
  tax_percent_default: 5,
  service_charge_enabled: false,
  compact_mode: false,
  default_dashboard_page: "dashboard",
 });
 const [saving, setSaving] = useState(false);
 const [savedAt, setSavedAt] = useState("");
 const [error, setError] = useState("");

 useEffect(() => {
  if (!settingsData) return;
  setForm((prev) => ({ ...prev, ...settingsData }));
 }, [settingsData]);

 const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

 const toggleRow = (label, sub, key) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
   <div>
    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{label}</div>
    <div style={{ fontSize: 12, color: "#64748b" }}>{sub}</div>
   </div>
   <button onClick={() => setField(key, !form[key])} style={{ width: 48, height: 28, borderRadius: 999, border: 0, padding: 2, cursor: "pointer", background: form[key] ? "#2563eb" : "#cbd5e1", transition: "background .2s ease" }}>
    <span style={{ width: 24, height: 24, borderRadius: 999, background: "#fff", display: "block", transform: form[key] ? "translateX(20px)" : "translateX(0)", transition: "transform .2s ease" }} />
   </button>
  </div>
 );

 const save = async () => {
  setSaving(true);
  setError("");
  try {
   await onSaveSettings({
    ...form,
    session_timeout_minutes: Number(form.session_timeout_minutes),
    auto_logout_minutes: Number(form.auto_logout_minutes),
    low_stock_threshold: Number(form.low_stock_threshold),
    tax_percent_default: Number(form.tax_percent_default),
   });
   setSavedAt(new Date().toLocaleString());
  } catch (err) {
   setError(err.message || "Failed to save settings");
  } finally {
   setSaving(false);
  }
 };

 const cardStyle = { background: "#fff", border: "1px solid #eef2f7", borderRadius: 14, padding: 18, boxShadow: "0 6px 20px rgba(15,23,42,0.06)" };
 const inputStyle = { width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" };
 const labelStyle = { display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#475569" };

 return (
  <div style={{ maxWidth: 1100, margin: "0 auto" }}>
   <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 12 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#0f172a" }}>Settings</h1>
     <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>Configure workspace preferences, alerts, security, and operations.</p>
    </div>
   </div>

   <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
    <div style={cardStyle}>
     <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>General</h3>
     <div style={{ display: "grid", gap: 10 }}>
      <div>
       <label style={labelStyle}>Language</label>
       <select value={form.language} onChange={(e) => setField("language", e.target.value)} style={inputStyle}>
        {["English", "Hindi", "Spanish", "French"].map((x) => <option key={x}>{x}</option>)}
       </select>
      </div>
      <div>
       <label style={labelStyle}>Timezone</label>
       <select value={form.timezone} onChange={(e) => setField("timezone", e.target.value)} style={inputStyle}>
        {["Asia/Kolkata", "UTC", "Europe/London", "America/New_York"].map((x) => <option key={x}>{x}</option>)}
       </select>
      </div>
      <div>
       <label style={labelStyle}>Date Format</label>
       <select value={form.date_format} onChange={(e) => setField("date_format", e.target.value)} style={inputStyle}>
        {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((x) => <option key={x}>{x}</option>)}
       </select>
      </div>
      <div>
       <label style={labelStyle}>Currency</label>
       <select value={form.currency} onChange={(e) => setField("currency", e.target.value)} style={inputStyle}>
        {["INR", "USD", "EUR", "GBP"].map((x) => <option key={x}>{x}</option>)}
       </select>
      </div>
     </div>
    </div>

    <div style={cardStyle}>
     <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Notifications</h3>
     {toggleRow("Desktop Notifications", "Show browser notifications for critical activity.", "desktop_notifications")}
     {toggleRow("Order Alert Sound", "Play a sound when a new order arrives.", "order_alert_sound")}
     {toggleRow("Daily Email Summary", "Receive end-of-day summary by email.", "daily_email_summary")}
     {toggleRow("Weekly Report", "Get weekly restaurant performance report.", "weekly_report")}
     <div style={{ marginTop: 10 }}>
      <label style={labelStyle}>Weekly Report Day</label>
      <select value={form.weekly_report_day} onChange={(e) => setField("weekly_report_day", e.target.value)} style={inputStyle}>
       {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((x) => <option key={x}>{x}</option>)}
      </select>
     </div>
    </div>

    <div style={cardStyle}>
     <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Security</h3>
     {toggleRow("Enforce 2FA", "Require second factor on every login.", "two_factor_required")}
     <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      <div>
       <label style={labelStyle}>Session Timeout (minutes)</label>
       <input type="number" min={5} value={form.session_timeout_minutes} onChange={(e) => setField("session_timeout_minutes", e.target.value)} style={inputStyle} />
      </div>
      <div>
       <label style={labelStyle}>Auto Logout (minutes)</label>
       <input type="number" min={5} value={form.auto_logout_minutes} onChange={(e) => setField("auto_logout_minutes", e.target.value)} style={inputStyle} />
      </div>
     </div>
    </div>

    <div style={cardStyle}>
     <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Operations</h3>
     {toggleRow("Low Stock Alert", "Notify when inventory goes below threshold.", "low_stock_alert")}
     <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      <div>
       <label style={labelStyle}>Low Stock Threshold</label>
       <input type="number" min={0} value={form.low_stock_threshold} onChange={(e) => setField("low_stock_threshold", e.target.value)} style={inputStyle} />
      </div>
      <div>
       <label style={labelStyle}>Default Tax (%)</label>
       <input type="number" min={0} max={50} step="0.1" value={form.tax_percent_default} onChange={(e) => setField("tax_percent_default", e.target.value)} style={inputStyle} />
      </div>
     </div>
     {toggleRow("Auto Print KOT", "Send KOT to printer automatically.", "auto_print_kot")}
     {toggleRow("Service Charge Enabled", "Apply service charge in billing.", "service_charge_enabled")}
    </div>

    <div style={cardStyle}>
     <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Interface</h3>
     {toggleRow("Compact Mode", "Reduce spacing for dense table views.", "compact_mode")}
     <div style={{ marginTop: 10 }}>
      <label style={labelStyle}>Default Dashboard Page</label>
      <select value={form.default_dashboard_page} onChange={(e) => setField("default_dashboard_page", e.target.value)} style={inputStyle}>
       {["dashboard", "orders", "kitchen", "billing", "tables", "menu"].map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
      </select>
     </div>
    </div>
   </div>

   <div style={{ position: "sticky", bottom: 0, zIndex: 12, marginTop: 16, background: "rgba(248,250,252,0.92)", border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
    <div style={{ fontSize: 12, color: error ? "#dc2626" : "#64748b" }}>{error || (savedAt ? `Last saved: ${savedAt}` : "All settings are editable and saved to backend.")}</div>
    <div style={{ display: "flex", gap: 10 }}>
     <Btn variant="ghost" onClick={() => settingsData && setForm((prev) => ({ ...prev, ...settingsData }))}>Cancel</Btn>
     <Btn onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Btn>
    </div>
   </div>
  </div>
 );
}

function ReportsPage({ orders }) {
 const data = [
  { label: "Mon", value: 180 }, { label: "Tue", value: 240 }, { label: "Wed", value: 190 },
  { label: "Thu", value: 280 }, { label: "Fri", value: 320 }, { label: "Sat", value: 390 }, { label: "Sun", value: 247 },
 ];
 const max = Math.max(...data.map(d => d.value));

 return (
  <div>
   <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
    <div>
     <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Reports & Analytics</h1>
     <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>Weekly performance overview</p>
    </div>
    <Btn variant="ghost"> Export Report</Btn>
   </div>
   <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
    <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
     <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>Weekly Orders</div>
     <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 180 }}>
      {data.map(d => (
       <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>{d.value}</div>
        <div style={{ width: "100%", background: d.label === "Sun" ? "#ff6b35" : "#ffcdb8", borderRadius: 6, height: `${(d.value / max) * 150}px`, transition: "height 0.3s" }} />
        <div style={{ fontSize: 12, color: "#888" }}>{d.label}</div>
       </div>
      ))}
     </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
     {[
      { label: "Best Selling", items: ["Butter Naan (85)", "Lassi (60)", "Chicken Biryani (45)"] },
      { label: "Category Split", items: ["Main Course: 58%", "Beverages: 22%", "Fast Food: 20%"] },
     ].map(card => (
      <div key={card.label} style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
       <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{card.label}</div>
       {card.items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
         <div style={{ width: 24, height: 24, borderRadius: "50%", background: ["#ff6b35", "#ffa000", "#43a047"][i], color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{i + 1}</div>
         <span style={{ fontSize: 13, color: "#555" }}>{item}</span>
        </div>
       ))}
      </div>
     ))}
    </div>
   </div>
  </div>
 );
}

// MODALS 

function QuickBillModal({ onClose, tables, onGenerateBill }) {
 const [table, setTable] = useState(tables?.[0]?.id || "T-01");
 const [taxPercent, setTaxPercent] = useState("5");
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [invoice, setInvoice] = useState(null);

 const generate = async () => {
  setLoading(true);
  setError("");
  try {
   const bill = await onGenerateBill({
    tableLabel: table,
    taxPercent: Number(taxPercent || 0),
   });
   setInvoice(bill);
  } catch (err) {
   setError(err.message || "Failed to generate bill");
  } finally {
   setLoading(false);
  }
 };

 return (
  <Modal title="Generate Quick Bill" onClose={onClose}>
   <Select label="Table" value={table} onChange={(e) => setTable(e.target.value)}>
    {tables.map((t) => <option key={t.id}>{t.id}</option>)}
   </Select>
   <Input label="Tax Percent" type="number" min={0} step="0.1" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
   {error && <div style={{ marginBottom: 10, color: "#d32f2f", fontSize: 12 }}>{error}</div>}

   {invoice && (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
     <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Bill #{invoice.billId} generated</div>
     <div style={{ display: "grid", gap: 4, fontSize: 13, color: "#0f172a" }}>
      <div>Table: <strong>{invoice.tableLabel}</strong></div>
      <div>Items: <strong>{invoice.items.length}</strong></div>
      <div>Subtotal: <strong>{invoice.total.toFixed(2)}</strong></div>
      <div>Tax: <strong>{invoice.tax.toFixed(2)}</strong></div>
      <div>Final: <strong>{invoice.final.toFixed(2)}</strong></div>
     </div>
    </div>
   )}

   <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <Btn variant="ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</Btn>
    <Btn style={{ flex: 1, justifyContent: "center" }} onClick={generate} disabled={loading}>{loading ? "Generating..." : "Generate Bill"}</Btn>
    <Btn variant="secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => invoice && openInvoicePrintWindow(invoice)} disabled={!invoice}>Print / Save PDF</Btn>
    <Btn variant="secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => invoice && downloadBillToDisk(invoice)} disabled={!invoice}>Download Bill</Btn>
   </div>
  </Modal>
 );
}

function PrintKOTModal({ onClose, onListKOTOrders, onLoadKOT }) {
 const [liveOrders, setLiveOrders] = useState([]);
 const [ordersLoading, setOrdersLoading] = useState(true);
 const [ordersError, setOrdersError] = useState("");
 const [orderId, setOrderId] = useState("");
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [kot, setKot] = useState(null);

 useEffect(() => {
  let mounted = true;
  const loadOrders = async () => {
   setOrdersLoading(true);
   setOrdersError("");
   try {
    const rows = await onListKOTOrders();
    if (!mounted) return;
    setLiveOrders(rows || []);
    setOrderId(rows?.[0]?.order_id ? String(rows[0].order_id) : "");
   } catch (err) {
    if (!mounted) return;
    setOrdersError(err.message || "Failed to load active KOT orders");
    setLiveOrders([]);
    setOrderId("");
   } finally {
    if (mounted) setOrdersLoading(false);
   }
  };
  loadOrders();
  return () => {
   mounted = false;
  };
 }, [onListKOTOrders]);

 const loadKOT = async () => {
  if (!orderId) return;
  setLoading(true);
  setError("");
  try {
   const parsedId = Number(String(orderId).replace("ORD-", ""));
   const data = await onLoadKOT(parsedId);
   setKot(data);
  } catch (err) {
   setError(err.message || "Failed to load KOT");
  } finally {
   setLoading(false);
  }
 };

 return (
  <Modal title="Print Kitchen Order Ticket (KOT)" onClose={onClose}>
   {ordersLoading ? (
    <div style={{ fontSize: 13, color: "#1e88e5", marginBottom: 14 }}>Loading active kitchen orders...</div>
   ) : ordersError ? (
    <div style={{ fontSize: 13, color: "#d32f2f", marginBottom: 14 }}>{ordersError}</div>
   ) : liveOrders.length === 0 ? (
    <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>No active kitchen orders available for KOT.</div>
   ) : (
    <>
     <Select label="Order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
      {liveOrders.map((o) => <option key={o.order_id} value={o.order_id}>{o.order_label} - {o.table_label} ({o.status})</option>)}
     </Select>
     {error && <div style={{ marginBottom: 10, color: "#d32f2f", fontSize: 12 }}>{error}</div>}
     {kot && (
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
       <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>KOT ready for print</div>
       <div style={{ display: "grid", gap: 4, fontSize: 13, color: "#0f172a" }}>
        <div>Order: <strong>{kot.orderLabel}</strong></div>
        <div>Table: <strong>{kot.tableLabel}</strong></div>
        <div>Items: <strong>{kot.items.length}</strong></div>
        <div>Status: <strong>{kot.status}</strong></div>
       </div>
      </div>
     )}
     <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Btn variant="ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</Btn>
      <Btn style={{ flex: 1, justifyContent: "center" }} onClick={loadKOT} disabled={loading}>{loading ? "Preparing..." : "Generate KOT"}</Btn>
      <Btn variant="secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => kot && openKOTPrintWindow(kot)} disabled={!kot}>Print / Save PDF</Btn>
      <Btn variant="secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => kot && downloadKOTToDisk(kot)} disabled={!kot}>Download KOT</Btn>
     </div>
    </>
   )}
  </Modal>
 );
}
function AddMenuModal({ onClose, onAdd, title = "Add Menu Item", initialForm = null }) {
 const [form, setForm] = useState(initialForm || { name: "", category: "Main Course", fullPrice: "", halfPrice: "", veg: true });
 return (
  <Modal title={title} onClose={onClose}>
   <Input label="Item Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Butter Chicken" />
   <Select label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
    {categories.filter(c => c !== "All").map(c => <option key={c}>{c}</option>)}
   </Select>
   <Input label="Full Price ($)" type="number" value={form.fullPrice} onChange={e => setForm({ ...form, fullPrice: e.target.value })} placeholder="0.00" />
   <Input label="Half Price ($) (Optional)" type="number" value={form.halfPrice} onChange={e => setForm({ ...form, halfPrice: e.target.value })} placeholder="0.00" />
   <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
    <span style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>Type:</span>
    {["Veg", "Non-Veg"].map(t => (
     <button key={t} onClick={() => setForm({ ...form, veg: t === "Veg" })} style={{ padding: "6px 14px", border: "1.5px solid", borderColor: (form.veg ? t === "Veg" : t === "Non-Veg") ? "#ff6b35" : "#e0e0e0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, background: (form.veg ? t === "Veg" : t === "Non-Veg") ? "#fff3ee" : "#fff", color: (form.veg ? t === "Veg" : t === "Non-Veg") ? "#ff6b35" : "#555" }}>{t}</button>
    ))}
   </div>
   <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
    <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
    <Btn onClick={async () => {
     if (form.name && form.fullPrice) {
      await onAdd(form);
      onClose();
     }
    }}>{title.startsWith("Edit") ? "Save Item" : "Add Item"}</Btn>
   </div>
  </Modal>
 );
}

function QRModal({ onClose, onLoadQRCodes }) {
 const [rows, setRows] = useState([]);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");

 useEffect(() => {
  let mounted = true;
  const load = async () => {
   setLoading(true);
   setError("");
   try {
    const data = await onLoadQRCodes();
    if (mounted) setRows(data || []);
   } catch (err) {
    if (mounted) setError(err.message || "Failed to load QR codes");
   } finally {
    if (mounted) setLoading(false);
   }
  };
  load();
  return () => { mounted = false; };
 }, [onLoadQRCodes]);

 const svgToPngDataUrl = (svgDataUrl) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
   const canvas = document.createElement("canvas");
   canvas.width = img.width || 512;
   canvas.height = img.height || 512;
   const ctx = canvas.getContext("2d");
   if (!ctx) {
    reject(new Error("Could not create canvas for QR conversion"));
    return;
   }
   ctx.fillStyle = "#ffffff";
   ctx.fillRect(0, 0, canvas.width, canvas.height);
   ctx.drawImage(img, 0, 0);
   resolve(canvas.toDataURL("image/png"));
  };
  img.onerror = () => reject(new Error("Failed to convert QR image"));
  img.src = svgDataUrl;
 });

 const downloadSingle = async (row) => {
  try {
   const source = row.qr_image || "";
   const href = source.startsWith("data:image/svg+xml") ? await svgToPngDataUrl(source) : source;
   const a = document.createElement("a");
   a.href = href;
   a.download = `qr-${row.table_label}.png`;
   document.body.appendChild(a);
   a.click();
   a.remove();
  } catch (err) {
   setError(err.message || "Failed to download QR file");
  }
 };

 const downloadAll = () => {
  rows.forEach((row, idx) => {
   setTimeout(() => { downloadSingle(row); }, idx * 140);
  });
 };

 return (
  <Modal title="Table QR Codes" onClose={onClose}>
   <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>Each QR is unique per table and downloadable as a real PNG.</p>
   {loading && <div style={{ marginBottom: 10, color: "#1e88e5", fontSize: 12 }}>Loading QR codes...</div>}
   {error && <div style={{ marginBottom: 10, color: "#d32f2f", fontSize: 12 }}>{error}</div>}
   <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
    {rows.map((row) => (
     <div key={row.table_id} style={{ border: "1.5px solid #e0e0e0", borderRadius: 10, padding: 12, textAlign: "center" }}>
      <img src={row.qr_image} alt={`QR ${row.table_label}`} style={{ width: 110, height: 110, objectFit: "contain", margin: "0 auto 8px", display: "block", background: "#fff", borderRadius: 8, border: "1px solid #f0f0f0" }} />
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{row.table_label}</div>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 8, wordBreak: "break-all" }}>{row.qr_payload}</div>
      <button onClick={() => { downloadSingle(row); }} style={{ background: "none", border: "none", color: "#ff6b35", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Download</button>
     </div>
    ))}
   </div>
   <Btn style={{ width: "100%", justifyContent: "center" }} onClick={downloadAll} disabled={!rows.length}>Download All QR Codes</Btn>
  </Modal>
 );
}
// APP 

const navItems = [
 { id: "dashboard", label: "Dashboard", icon: "", section: "MAIN MENU" },
 { id: "kitchen", label: "Kitchen Module", icon: "" },
 { id: "menu", label: "Menu Management", icon: "" },
 { id: "tables", label: "Table Management", icon: "" },
 { id: "billing", label: "Billing & Payments", icon: "" },
 { id: "orders", label: "Order History", icon: "" },
 { id: "menuitems", label: "Menu Items", icon: "", section: "MANAGEMENT" },
 { id: "qrcodes", label: "Tables & QR Codes", icon: "" },
 { id: "staff", label: "Staff Management", icon: "" },
 { id: "profile", label: "Profile Management", icon: "" },
 { id: "settings", label: "Settings", icon: "" },
 { id: "reports", label: "Reports & Analytics", icon: "" },
];

export default function App() {
 const [page, setPage] = useState("dashboard");
 const [orders, setOrders] = useState(initialOrders);
 const [tables, setTables] = useState(initialTables);
 const [menuItems, setMenuItems] = useState(menuItemsData);
 const [staff, setStaff] = useState(staffData);
 const [profileData, setProfileData] = useState(null);
 const [settingsData, setSettingsData] = useState(null);
 const [modal, setModal] = useState(null);
 const [showProfile, setShowProfile] = useState(false);
 const [notifOpen, setNotifOpen] = useState(false);
 const [token, setToken] = useState(localStorage.getItem("restro_token") || "");
 const [authForm, setAuthForm] = useState({ email: "manager@demo.com", password: "123456" });
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const newOrders = orders.filter(o => o.status === "New").length;
 const kitchenPendingOrders = orders.filter((o) => o.status === "New" || o.status === "Preparing").length;

 const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

 const handleAppError = (err, fallbackMessage) => {
  const message = err?.message || fallbackMessage;
  if (String(message).includes("Session expired")) {
   localStorage.removeItem("restro_token");
   setToken("");
   setError("Session expired. Please login again.");
   return message;
  }
  setError(message || fallbackMessage);
  return message;
 };

 const fetchDashboard = async (activeToken = token, options = {}) => {
  const { silent = false } = options;
  if (!activeToken) {
   return;
  }

  if (!silent) {
   setLoading(true);
   setError("");
  }
  try {
   const data = await apiRequest("/restaurant/dashboard", {
    headers: { Authorization: `Bearer ${activeToken}` },
   });
   setOrders(data.orders || []);
   setTables(data.tables || []);
   setMenuItems(data.menu_items || []);
   setStaff(data.staff || []);
  } catch (err) {
   handleAppError(err, "Failed to load dashboard");
  } finally {
   if (!silent) {
    setLoading(false);
   }
  }
 };

 const fetchProfile = async (activeToken = token) => {
  if (!activeToken) return;
  try {
   const data = await apiRequest("/auth/profile", {
    headers: { Authorization: `Bearer ${activeToken}` },
   });
   setProfileData(data);
  } catch (err) {
   handleAppError(err, "Failed to load profile");
  }
 };

 const fetchSettings = async (activeToken = token) => {
  if (!activeToken) return;
  try {
   const data = await apiRequest("/auth/settings", {
    headers: { Authorization: `Bearer ${activeToken}` },
   });
   setSettingsData(data);
  } catch (err) {
   handleAppError(err, "Failed to load settings");
  }
 };

 useEffect(() => {
  fetchDashboard();
  fetchProfile();
  fetchSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [token]);

 useEffect(() => {
  if (!token) return undefined;
  const pollId = setInterval(() => {
   fetchDashboard(token, { silent: true });
  }, 5000);
  return () => clearInterval(pollId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [token]);

 const login = async () => {
  setLoading(true);
  setError("");
  try {
   const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(authForm),
   });
   localStorage.setItem("restro_token", data.access_token);
   setToken(data.access_token);
  } catch (err) {
   setError(err.message || "Login failed");
  } finally {
   setLoading(false);
  }
 };

 const logout = () => {
  localStorage.removeItem("restro_token");
  setToken("");
  setProfileData(null);
  setSettingsData(null);
 };

 const updateOrderStatus = async (orderId, status) => {
  try {
   await apiRequest(`/restaurant/orders/${orderId}/status`, {
    method: "PUT",
    headers: authHeader,
    body: JSON.stringify({ status }),
   });

   await fetchDashboard();
  } catch (err) {
   handleAppError(err, "Failed to update order");
  }
 };

const addMenuItem = async (form) => {
 try {
  const payload = {
   name: form.name,
   description: `${form.veg ? "Veg" : "Non-Veg"} item`,
   price: parseFloat(form.fullPrice),
   half_price: form.halfPrice !== "" ? parseFloat(form.halfPrice) : null,
   category: form.category,
  };
  await apiRequest("/restaurant/menu", {
   method: "POST",
    headers: authHeader,
    body: JSON.stringify(payload),
   });
   await fetchDashboard();
  } catch (err) {
   handleAppError(err, "Failed to add menu item");
 }
};

 const updateMenuItem = async (itemId, form) => {
  try {
   const payload = {
    name: form.name,
    description: `${form.veg ? "Veg" : "Non-Veg"} item`,
    price: parseFloat(form.fullPrice),
    half_price: form.halfPrice !== "" ? parseFloat(form.halfPrice) : null,
    category: form.category,
   };
   await apiRequest(`/restaurant/menu/${itemId}`, {
    method: "PUT",
    headers: authHeader,
    body: JSON.stringify(payload),
   });
   await fetchDashboard();
  } catch (err) {
   handleAppError(err, "Failed to update menu item");
  }
 };

 const createStaff = async (form) => {
  const roleMap = {
   Waiter: "waiter",
   Chef: "kitchen",
   Cashier: "cashier",
   Manager: "restaurant_manager",
  };
  try {
   await apiRequest("/restaurant/staff", {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({
     name: form.name,
     email: form.email,
     password: form.password,
     role: roleMap[form.role] || "waiter",
    }),
   });
   await fetchDashboard();
  } catch (err) {
   handleAppError(err, "Failed to add staff");
  }
 };

 const changePassword = async (currentPassword, newPassword) => {
  try {
   await apiRequest("/auth/change-password", {
    method: "PUT",
    headers: authHeader,
    body: JSON.stringify({
     current_password: currentPassword,
     new_password: newPassword,
    }),
   });
  } catch (err) {
   const msg = handleAppError(err, "Failed to change password");
   throw new Error(msg);
  }
 };

 const saveProfile = async (form, prefs) => {
  try {
   await apiRequest("/auth/profile", {
    method: "PUT",
    headers: authHeader,
    body: JSON.stringify({
     first_name: form.firstName,
     last_name: form.lastName,
     email: form.email,
     mobile: form.mobile,
     gender: form.gender,
     dob: form.dob,
     address: form.address,
     city: form.city,
     state: form.state,
     country: form.country,
     postal_code: form.postalCode,
     bio: form.bio,
     avatar_image: form.avatarImage || "",
     email_notifications: prefs.emailNotifications,
     sms_notifications: prefs.smsNotifications,
    }),
   });
   await fetchProfile();
  } catch (err) {
   const msg = handleAppError(err, "Failed to save profile");
   throw new Error(msg);
  }
 };

 const saveSettings = async (settingsPayload) => {
  try {
   await apiRequest("/auth/settings", {
    method: "PUT",
    headers: authHeader,
    body: JSON.stringify(settingsPayload),
   });
   await fetchSettings();
  } catch (err) {
   const msg = handleAppError(err, "Failed to save settings");
   throw new Error(msg);
  }
 };

 const generateQuickBill = async ({ tableLabel, taxPercent }) => {
  const selectedById = tables.find((t) => t.id === tableLabel);
  const parsedTableNumber = parseInt(String(tableLabel || "").replace(/\D/g, ""), 10);
  const selectedByNumber = Number.isFinite(parsedTableNumber) ? tables.find((t) => t.table_number === parsedTableNumber) : null;
  const tableId = selectedById?.table_id || selectedByNumber?.table_id || parsedTableNumber;

  if (!tableId || Number.isNaN(Number(tableId))) {
   throw new Error("Unable to resolve table id for billing.");
  }

  try {
   const generated = await apiRequest("/billing/generate", {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({
     table_id: Number(tableId),
     tax_percent: Number.isFinite(Number(taxPercent)) ? Number(taxPercent) : 0,
    }),
   });

   const billData = await apiRequest(`/billing/${generated.bill_id}`, {
    headers: authHeader,
   });

   const invoice = {
    billId: generated.bill_id,
    tableLabel: tableLabel,
    restaurantName: restaurantHeading,
    generatedAt: new Date().toLocaleString(),
    items: billData?.items || [],
    total: Number(generated.total || 0),
    tax: Number(generated.tax || 0),
    final: Number(generated.final || 0),
   };

   return invoice;
  } catch (err) {
   const msg = handleAppError(err, "Failed to generate bill");
   throw new Error(msg);
  }
 };

 const loadKOT = useCallback(async (orderId) => {
  try {
   const response = await apiRequest(`/billing/kot/${orderId}`, {
    headers: authHeader,
   });
   return {
    orderLabel: response.order_label || `ORD-${orderId}`,
    tableLabel: response.table_label || "-",
    status: response.status || "-",
    generatedAt: new Date().toLocaleString(),
    items: response.items || [],
   };
  } catch (err) {
   const msg = handleAppError(err, "Failed to load KOT");
   throw new Error(msg);
  }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [token]);

 const listKOTOrders = useCallback(async () => {
  try {
   const rows = await apiRequest("/billing/kot/orders", {
    headers: authHeader,
   });
   return rows || [];
  } catch (err) {
   const msg = handleAppError(err, "Failed to load KOT orders");
   throw new Error(msg);
  }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [token]);

 const loadQRCodes = async () => {
  try {
   const data = await apiRequest("/restaurant/qrcodes", {
    headers: authHeader,
   });
   return data || [];
  } catch (err) {
   const msg = handleAppError(err, "Failed to load QR codes");
   throw new Error(msg);
  }
 };

 const addTables = async (count) => {
  const existingMax = tables.reduce((max, t) => {
   const n = Number(t.table_number || parseInt(String(t.id || "").replace(/\D/g, ""), 10) || 0);
   return Math.max(max, n);
  }, 0);

  try {
   for (let i = 1; i <= count; i += 1) {
    await apiRequest("/restaurant/tables", {
     method: "POST",
     headers: authHeader,
     body: JSON.stringify({ table_number: existingMax + i }),
    });
   }
   await fetchDashboard();
  } catch (err) {
   const msg = handleAppError(err, "Failed to add tables");
   throw new Error(msg);
  }
 };

 const updateTableStatus = async (tableId, status) => {
  try {
   await apiRequest(`/restaurant/tables/${Number(tableId)}/status`, {
    method: "PUT",
    headers: authHeader,
    body: JSON.stringify({ status }),
   });
   await fetchDashboard(token, { silent: true });
  } catch (err) {
   const msg = handleAppError(err, "Failed to update table status");
   await fetchDashboard(token, { silent: true });
   throw new Error(msg);
  }
 };

 const renderPage = () => {
  switch (page) {
   case "dashboard": return <Dashboard orders={orders} setOrders={setOrders} tables={tables} setTables={setTables} setPage={setPage} setModal={setModal} menuItems={menuItems} />;
   case "kitchen": return <KitchenModule orders={orders} onUpdateOrderStatus={updateOrderStatus} />;
   case "menu": case "menuitems": return <MenuPage setModal={setModal} menuItems={menuItems} setMenuItems={setMenuItems} onUpdateMenuItem={updateMenuItem} />;
   case "tables": case "qrcodes": return <TablesPage tables={tables} setTables={setTables} onAddTables={addTables} onUpdateTableStatus={updateTableStatus} />;
   case "billing": return <BillingPage orders={orders} />;
   case "orders": return <OrdersPage orders={orders} onUpdateOrderStatus={updateOrderStatus} />;
   case "staff": return <StaffPage staff={staff} setStaff={setStaff} onCreateStaff={createStaff} />;
   case "profile": return <ProfileManagementPage profile={profileData} onSaveProfile={saveProfile} />;
   case "settings": return <SettingsPage settingsData={settingsData} onSaveSettings={saveSettings} />;
   case "change-password": return <ChangePasswordPage setPage={setPage} onChangePassword={changePassword} />;
   case "reports": return <ReportsPage orders={orders} />;
   default: return <Dashboard orders={orders} setOrders={setOrders} tables={tables} setTables={setTables} setPage={setPage} setModal={setModal} menuItems={menuItems} />;
  }
 };

 const displayName = `${profileData?.first_name || "Admin"} ${profileData?.last_name || ""}`.trim();
 const displayRole = (profileData?.role || "admin").replaceAll("_", " ");
 const displayAvatar = profileData?.avatar_image || "";
 const displayInitial = (displayName?.[0] || "A").toUpperCase();
 const restaurantHeading = "Gurukripa Family Restaurant";

 if (!token) {
  return (
   <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f7f8fa", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
    <div style={{ width: 420, maxWidth: "92vw", background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 12px 40px rgba(0,0,0,0.08)" }}>
     <h2 style={{ marginTop: 0, marginBottom: 6 }}>Manager Login</h2>
     <p style={{ marginTop: 0, color: "#666", fontSize: 13 }}>Use a `restaurant_manager` account to load admin APIs.</p>
     <Input label="Email" value={authForm.email} onChange={e => setAuthForm({ ...authForm, email: e.target.value })} />
     <Input label="Password" type="password" value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} />
     {error && <div style={{ color: "#d32f2f", fontSize: 12, marginBottom: 8 }}>{error}</div>}
     <Btn style={{ width: "100%", justifyContent: "center" }} onClick={login} disabled={loading}>
      {loading ? "Logging in..." : "Login"}
     </Btn>
     <div style={{ marginTop: 10, color: "#888", fontSize: 12 }}>Tip: seed manager example is `manager@demo.com / 123456`.</div>
    </div>
   </div>
  );
 }

 return (
  <div style={{ display: "flex", height: "100vh", fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#f7f8fa", overflow: "hidden" }}>
   {/* Sidebar */}
   <div style={{ width: 200, background: "#1a1a2e", color: "#fff", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
    <div style={{ padding: "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
     <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <img
       src="/restroscan_logo.png"
       alt="RestroScan Logo"
       style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", background: "#0b0b12" }}
      />
      <div>
       <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: -0.3 }}>RestroScan</div>
       <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Restaurant POS</div>
      </div>
     </div>
    </div>
    <nav style={{ padding: "12px 8px", flex: 1 }}>
     {navItems.map((item, i) => (
      <div key={item.id}>
       {item.section && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", padding: "12px 8px 4px", fontWeight: 700, letterSpacing: 1 }}>{item.section}</div>}
       <button onClick={() => setPage(item.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: "none", cursor: "pointer", background: page === item.id ? "rgba(255,107,53,0.2)" : "transparent", color: page === item.id ? "#ff6b35" : "rgba(255,255,255,0.65)", fontSize: 13, fontWeight: page === item.id ? 700 : 400, textAlign: "left", transition: "all 0.15s", marginBottom: 2 }}>
        <span style={{ fontSize: 15 }}>{item.icon}</span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {((item.id === "kitchen" ? kitchenPendingOrders : item.badge) > 0) && (
         <span style={{ background: "#ff6b35", color: "#fff", borderRadius: 20, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>
          {item.id === "kitchen" ? kitchenPendingOrders : item.badge}
         </span>
        )}
       </button>
      </div>
     ))}
    </nav>
    <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
     RestroScan v2.0 Admin
    </div>
   </div>

   {/* Main */}
   <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
    {/* Topbar */}
    <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "0 24px", height: 60, display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
     <div style={{ flex: 1, minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#ff6b35", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
       {restaurantHeading}
      </h2>
     </div>
     <div style={{ position: "relative" }}>
      <button
       onClick={() => setNotifOpen(!notifOpen)}
       aria-label="Notifications"
       style={{ background: "none", border: "none", cursor: "pointer", position: "relative", padding: 4, color: "#475569" }}
      >
       <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 18H9M16.5 8.5C16.5 6.01472 14.4853 4 12 4C9.51472 4 7.5 6.01472 7.5 8.5V10.678C7.5 11.1415 7.35922 11.5941 7.09611 11.9757L5.65086 14.0718C5.01117 15.0003 5.67532 16.25 6.81024 16.25H17.1898C18.3247 16.25 18.9888 15.0003 18.3491 14.0718L16.9039 11.9757C16.6408 11.5941 16.5 11.1415 16.5 10.678V8.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
       </svg>
       {newOrders > 0 && <span style={{ position: "absolute", top: 0, right: 0, background: "#ff6b35", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{newOrders}</span>}
      </button>
      {notifOpen && (
       <div style={{ position: "absolute", right: 0, top: 44, background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 12, width: 260, boxShadow: "0 8px 30px rgba(0,0,0,0.12)", zIndex: 100 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>Notifications</div>
        {orders.filter(o => o.status === "New").map(o => (
         <div key={o.id} style={{ padding: "8px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12, color: "#555" }}>
           New order #{o.id} from {o.table}
         </div>
        ))}
        {newOrders === 0 && <div style={{ fontSize: 12, color: "#aaa", textAlign: "center", padding: 8 }}>All caught up! </div>}
       </div>
      )}
     </div>
     <div style={{ position: "relative" }}>
      <button onClick={() => setShowProfile(!showProfile)} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 10 }}>
       {displayAvatar ? (
        <img src={displayAvatar} alt="Profile" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "2px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }} />
       ) : (
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#ff6b35", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 15 }}>{displayInitial}</div>
       )}
       <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>{displayName}</div>
        <div style={{ fontSize: 11, color: "#888" }}>{displayRole}</div>
       </div>
       <span style={{ fontSize: 12, color: "#aaa" }}></span>
      </button>
      {showProfile && (
       <div style={{ position: "absolute", right: 0, top: 52, background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 8, width: 180, boxShadow: "0 8px 30px rgba(0,0,0,0.12)", zIndex: 100 }}>
        {[["", "Profile"], ["", "Settings"], ["", "Change Password"], ["", "Logout"]].map(([icon, label]) => (
         <button key={label} onClick={() => {
          if (label === "Logout") {
           logout();
          } else if (label === "Profile") {
           setPage("profile");
          } else if (label === "Settings") {
           setPage("settings");
          } else if (label === "Change Password") {
           setPage("change-password");
          } else {
           alert(`${label} clicked`);
          }
          setShowProfile(false);
         }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "none", background: "none", cursor: "pointer", borderRadius: 8, fontSize: 13, color: label === "Logout" ? "#d32f2f" : "#333", fontWeight: 500 }}>{icon} {label}</button>
        ))}
       </div>
      )}
     </div>
    </div>

    {/* Content */}
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
     {loading && <div style={{ marginBottom: 12, fontSize: 13, color: "#1e88e5" }}>Loading latest data...</div>}
     {error && <div style={{ marginBottom: 12, fontSize: 13, color: "#d32f2f" }}>{error}</div>}
     {renderPage()}
    </div>
   </div>

   {/* Modals */}
   {modal === "quickbill" && <QuickBillModal onClose={() => setModal(null)} tables={tables} onGenerateBill={generateQuickBill} />}
   {modal === "printkot" && <PrintKOTModal onClose={() => setModal(null)} onListKOTOrders={listKOTOrders} onLoadKOT={loadKOT} />}
   {modal === "addmenu" && <AddMenuModal onClose={() => setModal(null)} onAdd={addMenuItem} />}
   {modal === "qrcode" && <QRModal onClose={() => setModal(null)} onLoadQRCodes={loadQRCodes} />}
  </div>
 );
}





