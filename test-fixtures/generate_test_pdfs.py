"""Generates 5 test PDFs for the fencing-chat workflow's attachment intake.

1. property-specs-complete.pdf      - new-quote flow, all 6 checklist fields present
2. property-specs-incomplete.pdf    - new-quote flow, height/removal/access missing
3. existing-quote-low-price.pdf     - compare flow, price already below market (expect ~$0 savings)
4. existing-quote-high-price.pdf    - compare flow, price well above market (expect real savings found)
5. existing-quote-garbled-fields.pdf- compare flow, same shape but nonsense values (edge case)

All numbers are picked against the generated 300-business dataset for
Berwick / Colorbond @ 20m (rates ranged 126-167/m, so cheapest ~$2,520,
priciest ~$3,340, average ~$3,040 for 20m before add-ons).

Run: python generate_test_pdfs.py
"""

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "pdfs")
os.makedirs(OUT_DIR, exist_ok=True)


def draw_doc(filename, title, lines, footer=None):
    path = os.path.join(OUT_DIR, filename)
    c = canvas.Canvas(path, pagesize=A4)
    width, height = A4
    y = height - 30 * mm

    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, y, title)
    y -= 12 * mm

    c.setFont("Helvetica", 11)
    for line in lines:
        if line == "":
            y -= 5 * mm
            continue
        if line.startswith("## "):
            c.setFont("Helvetica-Bold", 12)
            c.drawString(20 * mm, y, line[3:])
            c.setFont("Helvetica", 11)
        else:
            c.drawString(20 * mm, y, line)
        y -= 7 * mm

    if footer:
        c.setFont("Helvetica-Oblique", 9)
        c.drawString(20 * mm, 15 * mm, footer)

    c.showPage()
    c.save()
    print("wrote", path)


# 1. Property/site specs — COMPLETE (all 6 new-quote checklist fields present)
draw_doc(
    "1-property-specs-complete.pdf",
    "Property & Fencing Site Specification",
    [
        "Prepared for: Homeowner enquiry",
        "Property address: 12 Wildwood Court, Berwick VIC 3806",
        "",
        "## Fencing Requirement",
        "Fence type requested: Colorbond",
        "Total fence length: approximately 24 metres (rear + one side boundary)",
        "Required height: 1800mm (standard boundary height)",
        "",
        "## Existing Fence",
        "Current fence: old timber paling fence, deteriorated, leaning in several sections.",
        "Removal of existing fence required before new installation: Yes",
        "",
        "## Site Access",
        "Rear yard is flat and clear, no steps or narrow side access.",
        "Site access rating: Easy",
        "",
        "## Notes",
        "No overhead power lines or underground services flagged on this side of the block.",
    ],
    footer="Test fixture — property/site specification, all fields present (new-quote flow).",
)

# 2. Property/site specs — INCOMPLETE (height, removal, access all missing)
draw_doc(
    "2-property-specs-incomplete.pdf",
    "Property Inspection Notes",
    [
        "Property address: 45 Grevillea Rise, Cranbourne North VIC 3977",
        "",
        "## Fencing Requirement",
        "Owner would like a Timber fence along the rear boundary.",
        "Rough measurement from the inspection: approx 18 metres.",
        "",
        "## Notes",
        "Inspector didn't record fence height, whether removal of anything existing",
        "is needed, or note site access conditions — follow up with the owner",
        "directly for those details.",
    ],
    footer="Test fixture — property/site specification, 3 of 6 fields missing (new-quote flow).",
)

# 3. Existing quote — LOW price (already at/below market for Berwick/Colorbond/20m)
draw_doc(
    "3-existing-quote-low-price.pdf",
    "Fencing Quotation",
    [
        "Quote #: BB-2291",
        "Issued by: Bargain Bob's Fencing",
        "Issued to: J. Carter",
        "",
        "## Job Details",
        "Site address: Berwick VIC 3806",
        "Fence type: Colorbond",
        "Length: 20 metres",
        "Height: 1800mm",
        "",
        "## Pricing",
        "Total quoted price (inc. GST): $2,400.00",
        "",
        "Valid for 30 days from date of issue.",
    ],
    footer="Test fixture — existing quote, priced BELOW the cheapest real competitor (~$2,520). Expect ~$0 potential savings.",
)

# 4. Existing quote — HIGH price (well above market for Berwick/Colorbond/20m)
draw_doc(
    "4-existing-quote-high-price.pdf",
    "Fencing Quotation",
    [
        "Quote #: PS-1187",
        "Issued by: Premium Select Fencing",
        "Issued to: J. Carter",
        "",
        "## Job Details",
        "Site address: Berwick VIC 3806",
        "Fence type: Colorbond",
        "Length: 20 metres",
        "Height: 1800mm",
        "",
        "## Pricing",
        "Total quoted price (inc. GST): $4,200.00",
        "",
        "Valid for 14 days from date of issue.",
    ],
    footer="Test fixture — existing quote, priced WELL ABOVE market (~$3,040 avg). Expect real savings to be found.",
)

# 5. Existing quote — garbled/implausible fields (edge case)
draw_doc(
    "5-existing-quote-garbled-fields.pdf",
    "Fencing Quotation",
    [
        "Quote #: QF-0778",
        "Issued by: QuickFence Test Co",
        "Issued to: Test Recipient",
        "",
        "## Job Details",
        "Site address: Berwyck VIC  (note: not a real suburb — intentional typo)",
        "Fence type: Chrome-Plated Diamond Mesh Deluxe",
        "Length: -5 metres",
        "Height: n/a",
        "",
        "## Pricing",
        "Total quoted price (inc. GST): $0.00",
        "",
        "This document intentionally has nonsensical values — used to test that",
        "the agent asks a clarifying question instead of guessing or crashing.",
    ],
    footer="Test fixture — garbled/invalid fields (edge case: bad suburb, unknown fence type, negative length, zero price).",
)

print("Done — 5 PDFs written to", OUT_DIR)
