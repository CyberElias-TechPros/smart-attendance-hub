// Client-side entry point for the shared timezone arithmetic.
// Same code the Worker uses, so a dashboard label and its query window can never
// disagree about which lectures count as "today".
export * from "../../shared/time";
