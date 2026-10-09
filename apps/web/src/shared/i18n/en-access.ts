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
    clinicBody: "Sign in with your clinic account's email and password.",
    platformBody:
      "The Eyadex team area. Sign in with your email and password, then your two-step code.",
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
    sessionLoadError: "We could not load your session",
    useBackupCode: "Lost your authenticator? Use a recovery code",
    useTotp: "Use the authenticator code instead",
    backupTitle: "Use a recovery code",
    backupBody:
      "Enter one of the recovery codes you saved when you set up two-step verification. Each code works once.",
    backupCode: "Recovery code",
    backupCodesTitle: "Your recovery codes",
    backupCodesBody:
      "Save these codes somewhere safe now: they are shown only once. Each one signs you in once if you lose your authenticator.",
    validation: { code: "Enter the 6-digit code", backupCode: "Enter a recovery code" },
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
    platformTitle: "Invitation to the Eyadex platform team",
    platformBody: "You were invited to join the Eyadex platform team. Choose a password to accept.",
    platformAcceptedTitle: "You are now on the platform team",
    platformAcceptedBody:
      "Your account is active. Sign in to the platform; you will be asked to set up two-step verification the first time.",
  },
} as const;

export const enAccessErrors = {
  conflict: "This change conflicts with the current data; refresh and try again",
  not_implemented: "This section is coming soon",
} as const;
