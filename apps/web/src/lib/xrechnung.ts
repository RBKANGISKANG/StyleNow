/**
 * XRechnung — the structured E-Rechnung, generated from a booking.
 *
 * Germany's "E-Rechnung" is not a PDF: it is machine-readable XML to the
 * EN 16931 semantic model, and XRechnung is the German profile of it. The
 * 2025 mandate covers B2B — a salon customer only ever needs this file when
 * they booked as a business and their bookkeeping wants a structured invoice
 * to ingest. That is exactly the door this module serves; the human-readable
 * Beleg stays the deliverable for everyone else.
 *
 * Format choice: XRechnung's UBL syntax, because it is plain XML we can emit
 * completely and inspect honestly. The other lawful shape, ZUGFeRD, embeds
 * XML inside PDF/A-3 — producing a *conformant* PDF/A-3 in the browser
 * without heavy tooling is not possible, and shipping an almost-PDF/A would
 * be a file that looks compliant and is not.
 *
 * Semantics the builder is careful about:
 *  - The engine stores gross line amounts (German consumer prices); EN 16931
 *    wants net lines. Each line is divided out of VAT and the largest line
 *    absorbs the rounding drift, so line sums, tax subtotal and totals agree
 *    to the cent — validators check exactly that.
 *  - Discounts become document-level AllowanceCharges, the structure the
 *    model provides for them, rather than negative invoice lines.
 *  - A Kleinunternehmer invoice carries tax category E with the §19 UStG
 *    exemption sentence and zero VAT — the same rule the visual Beleg obeys.
 *  - Deposits already paid surface as BT-113 (prepaid), so the payable
 *    amount is what is actually still owed.
 */
import type { BillingProfile } from '@/core/store';

export interface XRechnungInput {
  reference: string;
  issueDate: string; // YYYY-MM-DD
  serviceDate: string; // YYYY-MM-DD
  seller: BillingProfile & { address: string };
  buyer: { name: string; street: string; zip: string; city: string };
  /** gross lines as the engine stores them; negatives are discounts */
  breakdown: Array<{ label: string; cents: number }>;
  totalCents: number;
  vatCents: number;
  paidCents: number;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const eur = (cents: number) => (cents / 100).toFixed(2);

const KLEINUNTERNEHMER_SENTENCE =
  'Kein Steuerausweis aufgrund der Anwendung der Kleinunternehmerregelung (§ 19 UStG).';

/** "Torstraße 112, 10119 Berlin" → street + postal/city, tolerant of odd input. */
function splitAddress(address: string): { street: string; zip: string; city: string } {
  const [street = address, rest = ''] = address.split(',').map((x) => x.trim());
  const m = rest.match(/^(\d{4,5})\s+(.+)$/);
  return { street, zip: m?.[1] ?? '', city: m?.[2] ?? rest };
}

export function buildXRechnung(input: XRechnungInput): string {
  const small = input.seller.smallBusiness;
  const rate = small ? 0 : 19;

  // Net the gross lines out. Positives are invoice lines, negatives become
  // allowances; the largest positive line absorbs rounding drift so that
  // lines − allowances === the engine's own net total, to the cent.
  const toNet = (cents: number) => (small ? cents : Math.round((cents * 100) / 119));
  const positives = input.breakdown.filter((l) => l.cents >= 0).map((l) => ({ ...l, net: toNet(l.cents) }));
  const allowances = input.breakdown.filter((l) => l.cents < 0).map((l) => ({ ...l, net: -toNet(-l.cents) }));
  const netTotal = input.totalCents - input.vatCents;
  const drift = netTotal - (positives.reduce((n, l) => n + l.net, 0) + allowances.reduce((n, l) => n + l.net, 0));
  if (positives.length > 0) {
    positives.reduce((a, b) => (b.net > a.net ? b : a)).net += drift;
  }
  const lineSum = positives.reduce((n, l) => n + l.net, 0);
  const allowanceSum = -allowances.reduce((n, l) => n + l.net, 0);

  const seller = splitAddress(input.seller.address);
  const prepaid = Math.min(Math.max(input.paidCents, 0), input.totalCents);

  const taxCategory = small
    ? `<cac:ClassifiedTaxCategory><cbc:ID>E</cbc:ID><cbc:Percent>0</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>`
    : `<cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>`;

  const lines = positives
    .map(
      (l, i) => `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${eur(l.net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(l.label)}</cbc:Name>
      ${taxCategory}
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${eur(l.net)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n');

  const allowanceXml = allowances
    .map(
      (l) => `  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>${esc(l.label)}</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="EUR">${eur(-l.net)}</cbc:Amount>
    <cac:TaxCategory><cbc:ID>${small ? 'E' : 'S'}</cbc:ID><cbc:Percent>${rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
  </cac:AllowanceCharge>`,
    )
    .join('\n');

  const taxSubtotal = small
    ? `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${eur(netTotal)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>E</cbc:ID>
        <cbc:Percent>0</cbc:Percent>
        <cbc:TaxExemptionReason>${esc(KLEINUNTERNEHMER_SENTENCE)}</cbc:TaxExemptionReason>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`
    : `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${eur(netTotal)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${eur(input.vatCents)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(input.reference)}</cbc:ID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(input.reference)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(seller.street)}</cbc:StreetName>
        <cbc:CityName>${esc(seller.city)}</cbc:CityName>
        <cbc:PostalZone>${esc(seller.zip)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(input.seller.taxId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>${input.seller.taxId.startsWith('DE') ? 'VAT' : 'FC'}</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(input.seller.legalName)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(input.buyer.street || 'n/a')}</cbc:StreetName>
        <cbc:CityName>${esc(input.buyer.city || 'n/a')}</cbc:CityName>
        <cbc:PostalZone>${esc(input.buyer.zip)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(input.buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:Delivery><cbc:ActualDeliveryDate>${input.serviceDate}</cbc:ActualDeliveryDate></cac:Delivery>
${allowanceXml}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${eur(small ? 0 : input.vatCents)}</cbc:TaxAmount>
${taxSubtotal}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${eur(lineSum)}</cbc:LineExtensionAmount>
    <cbc:AllowanceTotalAmount currencyID="EUR">${eur(allowanceSum)}</cbc:AllowanceTotalAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${eur(netTotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${eur(input.totalCents)}</cbc:TaxInclusiveAmount>
    <cbc:PrepaidAmount currencyID="EUR">${eur(prepaid)}</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="EUR">${eur(input.totalCents - prepaid)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>
`;
}
