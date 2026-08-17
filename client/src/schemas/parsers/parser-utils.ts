/**
 * Common utilities shared between SQL and Mermaid parsers
 */

/**
 * Color palette with 15 high-contrast colors for dark blue backgrounds
 */
export const COLOR_PALETTE = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#84cc16", // Lime
  "#f97316", // Orange
  "#ef4444", // Red
  "#14b8a6", // Teal
  "#a855f7", // Purple
  "#f43f5e", // Rose
  "#22d3ee", // Sky
  "#34d399", // Green
  "#fbbf24", // Yellow
];

/**
 * Guess category from table name based on keywords.
 *
 * The list is ordered — the FIRST matching keyword wins — so more specific
 * domain groups (real-estate CRM: offers, deals, deposits, portals, ...)
 * come before generic buckets. Rules that must outrank each other are
 * annotated; e.g. "ranking" (Analytics) sits before "viewing" so
 * ViewingRankingResults lands in Analytics while Viewings stays a group of
 * its own.
 */
export function guessCategory(tableName: string): string {
  const name = tableName.toLowerCase();

  const categories = [
    {
      name: "Auth",
      keywords: [
        "user",
        "auth",
        "account",
        "profile",
        "password",
        "role",
        "permission",
        "openiddict",
        "impersonation",
      ],
    },
    // Framework/platform tables (before everything else so Abp* internals
    // don't leak into domain groups; Abp user/role tables are caught by
    // Auth above)
    {
      name: "System",
      keywords: ["abp", "webhook"],
    },
    // Before Viewings/Offers: rankings/KPIs/comparative analyses
    {
      name: "KPI",
      keywords: [
        "cma",
        "kpi",
        "ranking",
        "efficiency",
        "analytics",
        "metrics",
        "reports",
      ],
    },
    { name: "ImotBg", keywords: ["imotbg"] },
    // Client search requests (SearchesOffers etc.) — before Portals/Offers
    { name: "Search", keywords: ["search"] },
    // Listing portals and export targets — before Offers/Projects so
    // *ExportedOffers/*ExportedProjects group with their portal.
    // Internal = the company's own brands (Address, Imoteka, Unique
    // Estates, New Estates, Forton) plus internal websites; everything
    // else exports to third-party portals. Internal must come first so
    // e.g. AddressExportedOffers doesn't fall through to "exported".
    {
      name: "Internal Portals",
      keywords: [
        "imoteka",
        "uniqueestates",
        "newestates",
        "fortonhomes",
        "addressexported",
        "internalwebsite",
      ],
    },
    {
      name: "External Portals",
      keywords: [
        "imotinet",
        "ocenimebg",
        "realistimo",
        "exported",
        "externalportal",
        "externaloffer",
        "externalagenc",
        "website",
        "portal",
      ],
    },
    { name: "Viewings", keywords: ["viewing"] },
    { name: "Deals", keywords: ["deal"] },
    { name: "Deposits", keywords: ["deposit"] },
    // Client-prefixed link/lookup tables (ClientsAddresses, ClientsTasks,
    // ...) must stay with clients rather than the linked entity's group.
    // "customer" stays in the LATER Clients rule so generic names like
    // customer_orders keep grouping by their entity (Order)
    { name: "Clients", keywords: ["client"] },
    // Before Offers so CampaignEmailOffers groups with campaigns
    {
      name: "Marketing",
      keywords: ["campaign", "marketing", "email", "source", "social"],
    },
    { name: "Offers", keywords: ["offer", "operation"] },
    { name: "Projects", keywords: ["project"] },
    { name: "Estates", keywords: ["estate", "building", "property"] },
    // Nomenclatures: property attribute lookups (furniture, heating,
    // construction, ...) plus the small reference/support families that
    // would otherwise clutter the legend as one-table groups (files,
    // images, tags, employees, schedules, migrations, ...)
    {
      name: "Nomenclatures",
      keywords: [
        "furniture",
        "heating",
        "condition",
        "completion",
        "construction",
        "facing",
        "fence",
        "garage",
        "joinery",
        "infrastructure",
        "regulation",
        "lease",
        "lifestyle",
        "floor",
        "house",
        "immunity",
        "advantage",
        "image",
        "file",
        "binary",
        "media",
        "video",
        "audio",
        "employee",
        "job",
        "position",
        "tag",
        "reason",
        "comment",
        "schedule",
        "queue",
        "migration",
      ],
    },
    // Order/customer precedence expected by generic schemas:
    // customer_orders -> Order, customer_addresses -> Clients
    {
      name: "Order",
      keywords: ["order", "purchase", "cart"],
    },
    {
      name: "Clients",
      keywords: ["customer"],
    },
    {
      name: "Locations",
      keywords: [
        "district",
        "populated",
        "province",
        "municipal",
        "countr",
        "street",
        "resort",
        "location",
        "address",
        "territor",
      ],
    },
    {
      name: "Organization",
      keywords: [
        "department",
        "division",
        "team",
        "office",
        "workplace",
        "sector",
        "compan",
      ],
    },
    {
      name: "Clients",
      keywords: [
        "contact",
        "partner",
        "gender",
        "marital",
        "nationalit",
        "title",
        "embassy",
      ],
    },
    {
      name: "Activities",
      keywords: [
        "meeting",
        "call",
        "task",
        "survey",
        "calendar",
        "workingtime",
        "match",
      ],
    },
    {
      name: "Financial",
      keywords: [
        "payment",
        "transaction",
        "invoice",
        "salary",
        "contract",
        "bank",
        "vat",
        "financ",
        "card",
      ],
    },
    {
      name: "Product",
      keywords: ["product", "item", "inventory", "category"],
    },
    {
      name: "Content",
      keywords: ["post", "article", "content"],
    },
    {
      name: "Metadata",
      keywords: ["meta"],
    },
    {
      name: "Notification",
      keywords: ["notification", "alert", "message"],
    },
    {
      name: "Logs",
      keywords: ["log", "audit", "history"],
    },
    {
      name: "Security",
      keywords: ["security", "authentication", "authorization"],
    },
    {
      name: "System",
      keywords: ["system", "config", "settings"],
    },
    {
      name: "Positions",
      keywords: [
        "faculty",
        "staff",
        "student",
        "advisor",
        "professor",
        "lecturer",
        "instructor",
        "tutor",
        "coach",
        "mentor",
        "consultant",
        "expert",
        "specialist",
        "practitioner",
        "professional",
      ],
    },
  ];

  for (const category of categories) {
    for (const keyword of category.keywords) {
      if (name.includes(keyword)) {
        return category.name;
      }
    }
  }

  return "General";
}

/**
 * Calculate table position in 3D space arranged in a circle
 */
export function calculatePosition(
  index: number,
  total: number
): [number, number, number] {
  if (total === 0) return [0, 0, 0];
  if (total === 1) return [0, 0, 0];

  const angle = (index / total) * Math.PI * 2;
  const radius = Math.max(8, Math.sqrt(total) * 2);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;

  return [x, 0, z];
}

/**
 * Create a category-to-color mapping, assigning colors from the palette
 */
export function createCategoryColorMap(
  categories: string[],
  colorPalette: string[] = COLOR_PALETTE
): Map<string, string> {
  const categoryMap = new Map<string, string>();

  for (const category of categories) {
    if (category && !categoryMap.has(category)) {
      const color = colorPalette[categoryMap.size % colorPalette.length];
      if (color) {
        categoryMap.set(category, color);
      }
    }
  }

  return categoryMap;
}
