import { parseContactPhoneField, parseCustomersCsv } from "./csv-parser.js";

// Phone + name parsing
const p1 = parseContactPhoneField("Maria 215-555-0101");
if (p1.contactName !== "Maria" || p1.contactPhone !== "215-555-0101") {
  throw new Error(`Phone parse failed: ${JSON.stringify(p1)}`);
}
const p2 = parseContactPhoneField("James (412) 555-0202");
if (p2.contactName !== "James" || p2.contactPhone !== "412-555-0202") {
  throw new Error(`Phone parse paren failed: ${JSON.stringify(p2)}`);
}

const pLower = parseContactPhoneField("maria 215-555-0101");
if (pLower.contactName !== "Maria") {
  throw new Error(`Contact name should be capitalized: ${JSON.stringify(pLower)}`);
}

// Column headers: name = restaurant; phone numbers = contact first name + phone
const csv = `name,street 1 (Address - Street 1),City(Address - City),phone numbers,Delivery instructions(specific delivery instructions for that restaurant),Territory(Which Territory the restaurant is in)
Test Bistro,1 Main St,Philadelphia,Tom 215-555-9999,Side door only,Philadelphia
`;

const csvLegacyHeader = `account name(Restaurant),street 1 (Address - Street 1),City(Address - City),phone numbers,Delivery instructions(specific delivery instructions for that restaurant),Territory(Which Territory the restaurant is in)
Legacy Bistro,2 Oak St,Pittsburgh,Sara 4125550202,Back door,Pittsburgh
`;

const p4 = parseContactPhoneField("Maria Santos 215-555-0101");
if (p4.contactName !== "Maria") throw new Error("Should use contact first name only");

const result = await parseCustomersCsv(csv, new Date("2026-09-10T12:00:00"));
if (result.errors.length > 0) throw new Error(result.errors.join("; "));
if (result.customers.length !== 1) throw new Error("Expected 1 customer");
if (result.customers[0].name !== "Test Bistro") throw new Error("Name mismatch");
if (result.customers[0].contactName !== "Tom") throw new Error("Contact name mismatch");
if (result.customers[0].contactPhone !== "215-555-9999") throw new Error("Phone mismatch");
if (result.customers[0].deliveryInstructions !== "Side door only") throw new Error("Instructions mismatch");
if (result.customers[0].territoryId !== "philadelphia") throw new Error("Territory mismatch");
if (Object.keys(result.suggestedCases).length > 0) throw new Error("Should not auto-create orders");

const legacy = await parseCustomersCsv(csvLegacyHeader, new Date("2026-09-10T12:00:00"));
if (legacy.errors.length > 0) throw new Error(legacy.errors.join("; "));
if (legacy.customers[0].contactPhone !== "412-555-0202") throw new Error("Legacy phone format failed");

if (legacy.customers[0].contactName !== "Sara") throw new Error("Legacy header parse failed");

const p3 = parseContactPhoneField("Chris 2155559999");
if (p3.contactName !== "Chris" || p3.contactPhone !== "215-555-9999") {
  throw new Error(`Digits-only phone parse failed: ${JSON.stringify(p3)}`);
}

const p5 = parseContactPhoneField("215-555-0101 Maria");
if (p5.contactName !== "Maria") throw new Error(`Name-after-phone parse failed: ${JSON.stringify(p5)}`);

const csvCombinedHeader = `name,street 1 (Address - Street 1),City(Address - City),Name and Phone Numbers,Delivery instructions(specific delivery instructions for that restaurant),Territory(Which Territory the restaurant is in)
Combined Bistro,3 Pine St,Philadelphia,Ana 215-555-8888,Front door,Philadelphia
`;

const combined = await parseCustomersCsv(csvCombinedHeader, new Date("2026-09-10T12:00:00"));
if (combined.errors.length > 0) throw new Error(combined.errors.join("; "));
if (combined.customers[0].contactName !== "Ana") throw new Error("Name and Phone Numbers header failed");

const csvSeparateContact = `name,street 1 (Address - Street 1),City(Address - City),Contact Name,phone numbers,Delivery instructions(specific delivery instructions for that restaurant),Territory(Which Territory the restaurant is in)
Split Bistro,4 Elm St,Philadelphia,Jordan Lee,215-555-7777,Loading dock,Philadelphia
`;

const split = await parseCustomersCsv(csvSeparateContact, new Date("2026-09-10T12:00:00"));
if (split.errors.length > 0) throw new Error(split.errors.join("; "));
if (split.customers[0].contactName !== "Jordan Lee") throw new Error("Separate contact name column failed");
if (split.customers[0].contactPhone !== "215-555-7777") throw new Error("Separate phone format failed");

console.log("CSV parser tests passed.");
