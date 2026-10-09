// Branches strings, split out to keep each dictionary file small.
export const enBranches = {
  branches: {
    title: "Branches",
    subtitle: "Manage the locations where your clinic operates.",
    new: "New branch",
    usage: "{active} of {limit} active branches",
    searchPlaceholder: "Search branch names",
    anyStatus: "Any status",
    columns: {
      name: "Branch",
      address: "Address",
      phone: "Phone",
      status: "Status",
      actions: "Actions",
    },
    createTitle: "Create branch",
    createSubtitle: "Add another location to this clinic.",
    editTitle: "Edit branch",
    editSubtitle: "Update this location's contact details.",
    fields: {
      nameAr: "Name (Arabic)",
      nameEn: "Name (English)",
      address: "Address (optional)",
      phone: "Phone (optional)",
    },
    created: "Branch created",
    updated: "Branch updated",
    deactivated: "Branch deactivated",
    reactivated: "Branch reactivated",
    deactivate: "Deactivate",
    reactivate: "Reactivate",
    deactivateTitle: "Deactivate branch?",
    deactivateBody:
      "This branch will no longer count toward the active branch limit. Existing records remain available.",
    reactivateTitle: "Reactivate branch?",
    reactivateBody:
      "This branch will become available again and count toward the active branch limit.",
    emptyTitle: "No branches found",
    emptyBody: "Try changing the search or status filter.",
    loadError: "Branches could not be loaded.",
    limitReached:
      "Active branch limit reached ({active} of {limit}). Contact the platform to increase it.",
    lastActive: "The clinic's last active branch cannot be deactivated.",
  },
};
