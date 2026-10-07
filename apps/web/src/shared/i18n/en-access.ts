/** Sign-in, area hosts and the HTTP-mode states (slice W1). */
export const enAccess = {
  comingNext: { title: "Coming next", body: "This screen is part of the next phase." },
  forbidden: {
    title: "Not allowed",
    body: "Your current role does not have access to this page.",
    home: "Go to my home",
  },
  comingSoon: {
    title: "This section is coming soon",
    body: "It will be available here once it is ready. Nothing is lost in the meantime.",
  },
  auth: {
    clinicTitle: "Sign in to your clinic",
    platformTitle: "Sign in to the Eyadex platform",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signOut: "Sign out",
    totpTitle: "Two-step verification",
    totpBody: "Enter the 6-digit code from your authenticator app.",
    totpCode: "Verification code",
    verify: "Verify",
    enrollTitle: "Set up two-step verification",
    enrollBody:
      "The platform requires two-step verification. Scan this code with an authenticator app, then enter the 6-digit code it shows.",
    enrollStart: "Show the setup code",
    enrollPasswordHint: "Confirm your password to create the setup code.",
    qrLabel: "Setup code for your authenticator app",
    manualKey: "Can't scan? Enter this key in the app",
    back: "Back",
    validation: { code: "Enter the 6-digit code" },
  },
  area: {
    wrongHostTitle: "This page is on another address",
    clinicBody: "Clinic screens open on the clinic address.",
    platformBody: "Platform screens open on the platform address.",
    goToClinic: "Go to the clinic address",
    goToPlatform: "Go to the platform address",
  },
  branchStranded: {
    title: "Some users rely on this branch alone",
    body: "{count} active users have no other active branch. If you continue, they will not reach any branch until you give them another one.",
    confirm: "Deactivate anyway",
  },
  createdClinic: {
    emailedTitle: "Invitation sent",
    emailedBody: "The first admin's invitation was emailed to {email}.",
  },
  inviteHttp: {
    bodyNoRole: "You were invited to join this clinic. Choose a password to accept.",
    signInNow: "Go to sign in",
  },
} as const;

export const enAccessErrors = {
  conflict: "This change conflicts with the current data; refresh and try again",
  not_implemented: "This section is coming soon",
} as const;
