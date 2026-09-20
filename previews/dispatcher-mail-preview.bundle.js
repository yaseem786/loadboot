(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // mnt/loadboot/app/shared/env.js
  function fail(msg) {
    const e = new Error("[LoadBoot env] " + msg);
    e.lbFatal = true;
    throw e;
  }
  var RAW, ENV, env_default;
  var init_env = __esm({
    "mnt/loadboot/app/shared/env.js"() {
      RAW = typeof window !== "undefined" && window.__LB_ENV || null;
      if (!RAW) fail("env-config.js did not load (window.__LB_ENV missing).");
      for (const k of ["environment", "supabaseUrl", "supabaseAnonKey", "projectId"]) {
        if (!RAW[k] || typeof RAW[k] !== "string") fail("missing env field: " + k);
      }
      if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(RAW.supabaseUrl)) {
        fail("supabaseUrl is not a valid Supabase https URL.");
      }
      if (RAW.supabaseUrl.indexOf("https://" + RAW.projectId + ".supabase.co") !== 0) {
        fail("supabaseUrl does not match projectId \u2014 refusing to run mis-wired env.");
      }
      if (/service_role/.test(RAW.supabaseAnonKey)) {
        fail("a service_role key was injected into the browser \u2014 refusing to run.");
      }
      ENV = Object.freeze({
        environment: RAW.environment,
        // 'production' | 'preview'
        isProduction: RAW.environment === "production",
        supabaseUrl: RAW.supabaseUrl,
        supabaseAnonKey: RAW.supabaseAnonKey,
        projectId: RAW.projectId,
        buildId: RAW.buildId || "dev"
      });
      env_default = ENV;
    }
  });

  // mnt/loadboot/app/shared/supabaseClient.js
  var supabaseClient_exports = {};
  __export(supabaseClient_exports, {
    default: () => supabaseClient_default,
    getClient: () => getClient
  });
  async function importSupabase() {
    let lastErr;
    for (const url of SUPABASE_JS_URLS) {
      try {
        return await import(
          /* @vite-ignore */
          url
        );
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }
  function portalName() {
    const p = typeof location !== "undefined" && location.pathname || "";
    if (p.indexOf("/app/partner/") === 0) return "partner";
    if (p.indexOf("/app/carrier/") === 0) return "carrier";
    if (p.indexOf("/app/command-center/") === 0) return "command-center";
    return "site";
  }
  function getClient() {
    if (!_clientPromise) {
      _clientPromise = importSupabase().then(
        ({ createClient }) => createClient(env_default.supabaseUrl, env_default.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            // Namespace storage per environment so a preview session can never be
            // confused with a production session in the same browser.
            storageKey: "lb-auth-" + env_default.environment + "-" + env_default.projectId
          },
          // bl_bp_0316: the header names the portal this page is running in. Server-side,
          // app_private.my_any_org() reads it so a user who owns BOTH a carrier org and a
          // broker org gets the broker's packet/agreements inside the partner portal and the
          // carrier's inside the carrier portal (previously always carrier-first).
          global: { headers: { "x-lb-app": portalName() + "/" + env_default.buildId } }
        })
      );
    }
    return _clientPromise;
  }
  var SUPABASE_JS_URLS, _clientPromise, supabaseClient_default;
  var init_supabaseClient = __esm({
    "mnt/loadboot/app/shared/supabaseClient.js"() {
      init_env();
      SUPABASE_JS_URLS = [
        "https://esm.sh/@supabase/supabase-js@2.45.4",
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
      ];
      _clientPromise = null;
      supabaseClient_default = getClient;
    }
  });

  // mnt/loadboot/app/shared/api.js
  var api_exports = {};
  __export(api_exports, {
    AUDIENCE_TYPES: () => AUDIENCE_TYPES,
    LOAD_SOURCE_TYPES: () => LOAD_SOURCE_TYPES,
    TEMPLATE_VARIABLES: () => TEMPLATE_VARIABLES,
    VAPID_PUBLIC_KEY: () => VAPID_PUBLIC_KEY,
    acceptAgreement: () => acceptAgreement,
    acceptDriverInvite: () => acceptDriverInvite,
    accessorialQueue: () => accessorialQueue,
    accountHealth: () => accountHealth,
    accountHealthBoard: () => accountHealthBoard,
    accountRequests: () => accountRequests,
    ackIncident: () => ackIncident,
    acknowledgeRC: () => acknowledgeRC,
    actionCenter: () => actionCenter,
    addAccessorial: () => addAccessorial,
    addAdjustment: () => addAdjustment,
    addTripNote: () => addTripNote,
    adminNote: () => adminNote,
    adminUserUpdate: () => adminUserUpdate,
    advanceTrip: () => advanceTrip,
    agentCarrierDirectory: () => agentCarrierDirectory,
    agentChainStatus: () => agentChainStatus,
    agentClaimUpline: () => agentClaimUpline,
    agentConfirmPayoutReceived: () => agentConfirmPayoutReceived,
    agentFeed: () => agentFeed,
    agentMsgList: () => agentMsgList,
    agentMsgSend: () => agentMsgSend,
    agentOnboardingStatus: () => agentOnboardingStatus,
    agentPayoutCenter: () => agentPayoutCenter,
    agentRequestPayout: () => agentRequestPayout,
    agentSaveOnboarding: () => agentSaveOnboarding,
    agentSendInvite: () => agentSendInvite,
    agentSuspend: () => agentSuspend,
    aiAssist: () => aiAssist,
    analyticsCarriers: () => analyticsCarriers,
    analyticsOps: () => analyticsOps,
    analyticsOverview: () => analyticsOverview,
    analyticsRevenue: () => analyticsRevenue,
    approveIncidentReschedule: () => approveIncidentReschedule,
    assignLoad: () => assignLoad,
    assignRole: () => assignRole,
    assignShipment: () => assignShipment,
    assignTripResources: () => assignTripResources,
    audienceEstimate: () => audienceEstimate,
    authorityBoard: () => authorityBoard,
    automationHealth: () => automationHealth,
    biExecutiveSummary: () => biExecutiveSummary,
    biTimeseries: () => biTimeseries,
    bookRequestCarrierPacket: () => bookRequestCarrierPacket,
    bookRequestsQueue: () => bookRequestsQueue,
    bookingStatus: () => bookingStatus,
    breakeven: () => breakeven,
    brokerClaimShipment: () => brokerClaimShipment,
    brokerQuoteShipment: () => brokerQuoteShipment,
    brokerShipmentInbox: () => brokerShipmentInbox,
    brokerSla: () => brokerSla,
    brokerSlaRanking: () => brokerSlaRanking,
    brokerTenderShipment: () => brokerTenderShipment,
    brokerViewCarrier: () => brokerViewCarrier,
    campaignAnalytics: () => campaignAnalytics,
    campaignApprove: () => campaignApprove,
    campaignAttribution: () => campaignAttribution,
    campaignAudiencePreview: () => campaignAudiencePreview,
    campaignDeleteVariant: () => campaignDeleteVariant,
    campaignEnqueue: () => campaignEnqueue,
    campaignSetVariant: () => campaignSetVariant,
    campaignVariantAnalytics: () => campaignVariantAnalytics,
    campaignVariants: () => campaignVariants,
    cancelAccountDeletion: () => cancelAccountDeletion,
    cancelPreview: () => cancelPreview,
    carrier360: () => carrier360,
    carrierAccountingExport: () => carrierAccountingExport,
    carrierAddExpense: () => carrierAddExpense,
    carrierAgreementSignature: () => carrierAgreementSignature,
    carrierAssignSuggestions: () => carrierAssignSuggestions,
    carrierBestLoads: () => carrierBestLoads,
    carrierBookingAck: () => carrierBookingAck,
    carrierDashboard: () => carrierDashboard,
    carrierDeleteExpense: () => carrierDeleteExpense,
    carrierDispatcherAck: () => carrierDispatcherAck,
    carrierDispatcherPause: () => carrierDispatcherPause,
    carrierEarnings: () => carrierEarnings,
    carrierEldDisconnect: () => carrierEldDisconnect,
    carrierEldSetup: () => carrierEldSetup,
    carrierEldStatus: () => carrierEldStatus,
    carrierExpenses: () => carrierExpenses,
    carrierFactoringBrokerSet: () => carrierFactoringBrokerSet,
    carrierFactoringBrokers: () => carrierFactoringBrokers,
    carrierFactoringPacket: () => carrierFactoringPacket,
    carrierFactoringRemitUpdate: () => carrierFactoringRemitUpdate,
    carrierFactoringSet: () => carrierFactoringSet,
    carrierFleetOptimization: () => carrierFleetOptimization,
    carrierFleetPlan: () => carrierFleetPlan,
    carrierFuelImport: () => carrierFuelImport,
    carrierInviteDriver: () => carrierInviteDriver,
    carrierLinkDriver: () => carrierLinkDriver,
    carrierListDocuments: () => carrierListDocuments,
    carrierLoadDetail: () => carrierLoadDetail,
    carrierMyDispatcher: () => carrierMyDispatcher,
    carrierMyDispatcherBookings: () => carrierMyDispatcherBookings,
    carrierOffers: () => carrierOffers,
    carrierPaymentProfile: () => carrierPaymentProfile,
    carrierPnl: () => carrierPnl,
    carrierPoaDemands: () => carrierPoaDemands,
    carrierRateableTrips: () => carrierRateableTrips,
    carrierReinstatements: () => carrierReinstatements,
    carrierRequestAccessorial: () => carrierRequestAccessorial,
    carrierRequestReverify: () => carrierRequestReverify,
    carrierScorecard: () => carrierScorecard,
    carrierScorecardRanking: () => carrierScorecardRanking,
    carrierSignAgreement: () => carrierSignAgreement,
    carrierStatement: () => carrierStatement,
    carrierSubmitW9: () => carrierSubmitW9,
    carrierUploadDocument: () => carrierUploadDocument,
    carrierViewPoster: () => carrierViewPoster,
    carrierW9: () => carrierW9,
    ccAccountDeletionProcess: () => ccAccountDeletionProcess,
    ccAccountDeletionQueue: () => ccAccountDeletionQueue,
    ccAgent360: () => ccAgent360,
    ccAgentDecide: () => ccAgentDecide,
    ccAgentDocReview: () => ccAgentDocReview,
    ccAgentMsgSend: () => ccAgentMsgSend,
    ccAgentMsgs: () => ccAgentMsgs,
    ccAgentNotifySend: () => ccAgentNotifySend,
    ccAgentPayoutApproveMethod: () => ccAgentPayoutApproveMethod,
    ccAgentPayoutRequestDetails: () => ccAgentPayoutRequestDetails,
    ccAgentPayoutVerify: () => ccAgentPayoutVerify,
    ccAgentsList: () => ccAgentsList,
    ccAgentsQueue: () => ccAgentsQueue,
    ccAskReschedule: () => ccAskReschedule,
    ccBrokerTrustQueue: () => ccBrokerTrustQueue,
    ccBrokerTrustSet: () => ccBrokerTrustSet,
    ccCarrierBackoffice: () => ccCarrierBackoffice,
    ccCarrierDriverAccess: () => ccCarrierDriverAccess,
    ccCarrierFleet360: () => ccCarrierFleet360,
    ccCarrierPrefs: () => ccCarrierPrefs,
    ccDialerCalls: () => ccDialerCalls,
    ccDialerConfigSet: () => ccDialerConfigSet,
    ccDialerLineRelease: () => ccDialerLineRelease,
    ccDialerLineUpsert: () => ccDialerLineUpsert,
    ccDialerOverview: () => ccDialerOverview,
    ccDialerSms: () => ccDialerSms,
    ccDispatcher360: () => ccDispatcher360,
    ccDispatcherActivity: () => ccDispatcherActivity,
    ccDispatcherAssign: () => ccDispatcherAssign,
    ccDispatcherBookingDecide: () => ccDispatcherBookingDecide,
    ccDispatcherBookings: () => ccDispatcherBookings,
    ccDispatcherCommissionList: () => ccDispatcherCommissionList,
    ccDispatcherCommissionPay: () => ccDispatcherCommissionPay,
    ccDispatcherCommissionStatus: () => ccDispatcherCommissionStatus,
    ccDispatcherDecide: () => ccDispatcherDecide,
    ccDispatcherKpis: () => ccDispatcherKpis,
    ccDispatcherPayouts: () => ccDispatcherPayouts,
    ccDispatcherQueue: () => ccDispatcherQueue,
    ccDispatcherResendIntro: () => ccDispatcherResendIntro,
    ccDispatcherSalaryRun: () => ccDispatcherSalaryRun,
    ccDispatcherSalarySet: () => ccDispatcherSalarySet,
    ccDispatcherSalaryStatus: () => ccDispatcherSalaryStatus,
    ccDispatcherSetTerms: () => ccDispatcherSetTerms,
    ccDispatcherSop: () => ccDispatcherSop,
    ccDispatcherTestInvite: () => ccDispatcherTestInvite,
    ccDispatcherTestReview: () => ccDispatcherTestReview,
    ccDispatcherTestScore: () => ccDispatcherTestScore,
    ccDispatcherTestSendScore: () => ccDispatcherTestSendScore,
    ccDispatcherUnassign: () => ccDispatcherUnassign,
    ccDispatchersBoard: () => ccDispatchersBoard,
    ccDispatchersList: () => ccDispatchersList,
    ccDispatchersPage: () => ccDispatchersPage,
    ccDispatchersStats: () => ccDispatchersStats,
    ccDmailAccountSave: () => ccDmailAccountSave,
    ccDmailActivity: () => ccDmailActivity,
    ccDmailAssign: () => ccDmailAssign,
    ccDmailOverview: () => ccDmailOverview,
    ccDmailSetStatus: () => ccDmailSetStatus,
    ccDriverAdoptionKpis: () => ccDriverAdoptionKpis,
    ccEmailBrokerVerify: () => ccEmailBrokerVerify,
    ccEmailLoads: () => ccEmailLoads,
    ccFactoringVerify: () => ccFactoringVerify,
    ccFleetTruckRemind: () => ccFleetTruckRemind,
    ccFleetTruckReminderStatus: () => ccFleetTruckReminderStatus,
    ccLcAssign: () => ccLcAssign,
    ccLcBotResume: () => ccLcBotResume,
    ccLcCalls: () => ccLcCalls,
    ccLcCannedDelete: () => ccLcCannedDelete,
    ccLcCannedList: () => ccLcCannedList,
    ccLcCannedSave: () => ccLcCannedSave,
    ccLcGet: () => ccLcGet,
    ccLcHeartbeat: () => ccLcHeartbeat,
    ccLcList: () => ccLcList,
    ccLcMissDismiss: () => ccLcMissDismiss,
    ccLcMisses: () => ccLcMisses,
    ccLcPresenceGet: () => ccLcPresenceGet,
    ccLcPresenceSet: () => ccLcPresenceSet,
    ccLcReply: () => ccLcReply,
    ccLcSetStatus: () => ccLcSetStatus,
    ccLcStats: () => ccLcStats,
    ccLcTeach: () => ccLcTeach,
    ccLcTyping: () => ccLcTyping,
    ccLoadStops: () => ccLoadStops,
    ccOnboardingRemind: () => ccOnboardingRemind,
    ccOnboardingReminderStatus: () => ccOnboardingReminderStatus,
    ccOutreachAudience: () => ccOutreachAudience,
    ccOutreachControl: () => ccOutreachControl,
    ccOutreachCrm: () => ccOutreachCrm,
    ccOutreachLog: () => ccOutreachLog,
    ccOutreachLogPage: () => ccOutreachLogPage,
    ccOutreachStats: () => ccOutreachStats,
    ccOutreachTemplatePreview: () => ccOutreachTemplatePreview,
    ccOutreachTemplateSave: () => ccOutreachTemplateSave,
    ccOutreachTemplates: () => ccOutreachTemplates,
    ccOutreachToday: () => ccOutreachToday,
    ccPayPendingFees: () => ccPayPendingFees,
    ccRetellCallback: () => ccRetellCallback,
    ccShipperTrustQueue: () => ccShipperTrustQueue,
    ccShipperTrustSet: () => ccShipperTrustSet,
    claimBundle: () => claimBundle,
    claimEscalate: () => claimEscalate,
    claimReferral: () => claimReferral,
    claimStaffInvite: () => claimStaffInvite,
    cmpList: () => cmpList,
    cmpMarkSent: () => cmpMarkSent,
    cmpSave: () => cmpSave,
    cmpSetStatus: () => cmpSetStatus,
    coiPanel: () => coiPanel,
    coiVehicles: () => coiVehicles,
    commOverview: () => commOverview,
    commTriggers: () => commTriggers,
    completeTask: () => completeTask,
    complianceOverview: () => complianceOverview,
    confirmTruckPosting: () => confirmTruckPosting,
    consentSummary: () => consentSummary,
    contactsDirectory: () => contactsDirectory,
    contentOverview: () => contentOverview,
    controlTower: () => controlTower,
    convertFormToLead: () => convertFormToLead,
    createAnnouncement: () => createAnnouncement,
    createApiKey: () => createApiKey,
    createCampaign: () => createCampaign,
    createEndpoint: () => createEndpoint,
    createInvoice: () => createInvoice,
    createLoad: () => createLoad,
    createLoadSourced: () => createLoadSourced,
    createPartnerInvoice: () => createPartnerInvoice,
    createRedirect: () => createRedirect,
    createSettlement: () => createSettlement,
    createThread: () => createThread,
    createTicket: () => createTicket,
    createTrip: () => createTrip,
    crmAddActivity: () => crmAddActivity,
    crmCreateLead: () => crmCreateLead,
    crmGetLead: () => crmGetLead,
    crmListLeads: () => crmListLeads,
    crmOverview: () => crmOverview,
    crmSetLeadStage: () => crmSetLeadStage,
    currentAgreement: () => currentAgreement,
    decideBookRequest: () => decideBookRequest,
    decideOnboarding: () => decideOnboarding,
    decidePartnerLoad: () => decidePartnerLoad,
    decidePartnerShipment: () => decidePartnerShipment,
    decideSettlement: () => decideSettlement,
    default: () => api_default,
    deleteAudience: () => deleteAudience,
    deliveryClaim: () => deliveryClaim,
    deliveryDocPack: () => deliveryDocPack,
    deliveryHealth: () => deliveryHealth,
    deliveryList: () => deliveryList,
    deliveryMark: () => deliveryMark,
    deliveryReleaseDue: () => deliveryReleaseDue,
    detentionScan: () => detentionScan,
    deviceSeen: () => deviceSeen,
    dialerBootstrap: () => dialerBootstrap,
    dialerCallStart: () => dialerCallStart,
    dialerCallTag: () => dialerCallTag,
    dialerCallUpdate: () => dialerCallUpdate,
    dialerCallbackSet: () => dialerCallbackSet,
    dialerClaimWaiting: () => dialerClaimWaiting,
    dialerForwardSet: () => dialerForwardSet,
    dialerHeartbeat: () => dialerHeartbeat,
    dialerHistory: () => dialerHistory,
    dialerLookup: () => dialerLookup,
    dialerRecordingBlob: () => dialerRecordingBlob,
    dialerSmsSend: () => dialerSmsSend,
    dialerSmsThread: () => dialerSmsThread,
    dialerSmsThreads: () => dialerSmsThreads,
    dialerToken: () => dialerToken,
    dispatchOverview: () => dispatchOverview,
    dispatchPlan: () => dispatchPlan,
    dispatchSheet: () => dispatchSheet,
    dispatcherApply: () => dispatcherApply,
    dispatcherBoard: () => dispatcherBoard,
    dispatcherBookingEvent: () => dispatcherBookingEvent,
    dispatcherBookingTimeline: () => dispatcherBookingTimeline,
    dispatcherBookingUpdate: () => dispatcherBookingUpdate,
    dispatcherBrokerDelete: () => dispatcherBrokerDelete,
    dispatcherBrokerUpsert: () => dispatcherBrokerUpsert,
    dispatcherLoadDetail: () => dispatcherLoadDetail,
    dispatcherLogBooking: () => dispatcherLogBooking,
    dispatcherMyKpis: () => dispatcherMyKpis,
    dispatcherMyStatus: () => dispatcherMyStatus,
    dispatcherPostTruck: () => dispatcherPostTruck,
    dispatcherPostingMatches: () => dispatcherPostingMatches,
    dispatcherReapply: () => dispatcherReapply,
    dispatcherRequestBook: () => dispatcherRequestBook,
    dispatcherSetAvailability: () => dispatcherSetAvailability,
    dispatcherSubmitId: () => dispatcherSubmitId,
    dispatcherTestMy: () => dispatcherTestMy,
    dispatcherTestSave: () => dispatcherTestSave,
    dispatcherTestStart: () => dispatcherTestStart,
    dispatcherTestSubmit: () => dispatcherTestSubmit,
    dispatcherThreadList: () => dispatcherThreadList,
    dispatcherThreadMarkRead: () => dispatcherThreadMarkRead,
    dispatcherThreadSend: () => dispatcherThreadSend,
    dispatcherTrip: () => dispatcherTrip,
    dispatcherTripAction: () => dispatcherTripAction,
    dispatcherUpdatePosting: () => dispatcherUpdatePosting,
    dispatcherWorkspaceFeed: () => dispatcherWorkspaceFeed,
    dmailAct: () => dmailAct,
    dmailBootstrap: () => dmailBootstrap,
    dmailContacts: () => dmailContacts,
    dmailDraftDiscard: () => dmailDraftDiscard,
    dmailDraftSave: () => dmailDraftSave,
    dmailList: () => dmailList,
    dmailPoll: () => dmailPoll,
    dmailThread: () => dmailThread,
    documentFile: () => documentFile,
    documentProvenance: () => documentProvenance,
    driverAccessList: () => driverAccessList,
    driverDocReview: () => driverDocReview,
    driverDocUpload: () => driverDocUpload,
    driverDocsForOwner: () => driverDocsForOwner,
    driverGrantsGet: () => driverGrantsGet,
    driverGrantsSet: () => driverGrantsSet,
    driverHeartbeat: () => driverHeartbeat,
    driverInvitePeek: () => driverInvitePeek,
    driverInviteResend: () => driverInviteResend,
    driverInviteRevoke: () => driverInviteRevoke,
    driverMyDocs: () => driverMyDocs,
    driverMyEarnings: () => driverMyEarnings,
    driverMySettlements: () => driverMySettlements,
    driverOrgSettings: () => driverOrgSettings,
    driverPermissionCatalog: () => driverPermissionCatalog,
    driverSetStatus: () => driverSetStatus,
    driverUpdateMyProfile: () => driverUpdateMyProfile,
    emergencyContactAdd: () => emergencyContactAdd,
    emergencyContactDelete: () => emergencyContactDelete,
    emergencyContacts: () => emergencyContacts,
    emergencyQueue: () => emergencyQueue,
    emergencyReview: () => emergencyReview,
    enqueueTransactional: () => enqueueTransactional,
    entityAudit: () => entityAudit,
    eventCatalog: () => eventCatalog,
    exceptionCenter: () => exceptionCenter,
    expenseAdd: () => expenseAdd,
    expenseDelete: () => expenseDelete,
    expenseList: () => expenseList,
    exportFinance: () => exportFinance,
    facilityRatings: () => facilityRatings,
    facilityReviewSubmit: () => facilityReviewSubmit,
    feeInvoiceApprove: () => feeInvoiceApprove,
    feeInvoiceQueue: () => feeInvoiceQueue,
    feeInvoiceReject: () => feeInvoiceReject,
    financeAnalytics: () => financeAnalytics,
    financeOverview: () => financeOverview,
    financePayables: () => financePayables,
    financeReceivables: () => financeReceivables,
    financeReconcile: () => financeReconcile,
    fleetExpiryBoard: () => fleetExpiryBoard,
    fleetFmcsaCheck: () => fleetFmcsaCheck,
    fleetMaintenance: () => fleetMaintenance,
    fleetOverview: () => fleetOverview,
    fleetServiceAdd: () => fleetServiceAdd,
    fleetServiceDelete: () => fleetServiceDelete,
    fleetServiceList: () => fleetServiceList,
    fmcsaVerify: () => fmcsaVerify,
    formProgressDone: () => formProgressDone,
    formProgressPing: () => formProgressPing,
    formsOverview: () => formsOverview,
    fuelPricesGet: () => fuelPricesGet,
    ga4Insights: () => ga4Insights,
    getAuditLogs: () => getAuditLogs,
    getBrandKit: () => getBrandKit,
    getBrokerVisibility: () => getBrokerVisibility,
    getCarrierCompliance: () => getCarrierCompliance,
    getCarrierDetail: () => getCarrierDetail,
    getCarriersDirectory: () => getCarriersDirectory,
    getCostModel: () => getCostModel,
    getDispatchPrefs: () => getDispatchPrefs,
    getDocumentsQueue: () => getDocumentsQueue,
    getFeatureFlags: () => getFeatureFlags,
    getForm: () => getForm,
    getInvoice: () => getInvoice,
    getLoadDetail: () => getLoadDetail,
    getLoadsList: () => getLoadsList,
    getMyStaffContext: () => getMyStaffContext,
    getOverviewStats: () => getOverviewStats,
    getPartner: () => getPartner,
    getPaymentInstructions: () => getPaymentInstructions,
    getPost: () => getPost,
    getRolesCatalog: () => getRolesCatalog,
    getSetting: () => getSetting,
    getStaffDirectory: () => getStaffDirectory,
    getThread: () => getThread,
    getTicket: () => getTicket,
    getTrip: () => getTrip,
    globalSearch: () => globalSearch,
    gscInsights: () => gscInsights,
    healthAdjust: () => healthAdjust,
    healthResetFactor: () => healthResetFactor,
    iftaSet: () => iftaSet,
    iftaSummary: () => iftaSummary,
    installPlugin: () => installPlugin,
    integrationStatus: () => integrationStatus,
    integrationsOverview: () => integrationsOverview,
    inviteStaff: () => inviteStaff,
    invoiceCredit: () => invoiceCredit,
    invoiceDocument: () => invoiceDocument,
    invoiceLookup: () => invoiceLookup,
    invoicePrepQueue: () => invoicePrepQueue,
    invoiceSendReminder: () => invoiceSendReminder,
    invoiceVoid: () => invoiceVoid,
    isFlagEnabled: () => isFlagEnabled,
    isMyOrgAgent: () => isMyOrgAgent,
    issueViolation: () => issueViolation,
    laneHistory: () => laneHistory,
    laneRate: () => laneRate,
    listAnnouncements: () => listAnnouncements,
    listApiKeys: () => listApiKeys,
    listAudiences: () => listAudiences,
    listCampaigns: () => listCampaigns,
    listCarrierOrgs: () => listCarrierOrgs,
    listCarrierVerifications: () => listCarrierVerifications,
    listChat: () => listChat,
    listCustomForms: () => listCustomForms,
    listDeliveries: () => listDeliveries,
    listDocumentFiles: () => listDocumentFiles,
    listDrivers: () => listDrivers,
    listEndpoints: () => listEndpoints,
    listExceptions: () => listExceptions,
    listForms: () => listForms,
    listInstalledPlugins: () => listInstalledPlugins,
    listIntegrations: () => listIntegrations,
    listInvoices: () => listInvoices,
    listKeywords: () => listKeywords,
    listModules: () => listModules,
    listNotifications: () => listNotifications,
    listOnboarding: () => listOnboarding,
    listPages: () => listPages,
    listPartnerAppointmentsAll: () => listPartnerAppointmentsAll,
    listPartnerInvoicesAll: () => listPartnerInvoicesAll,
    listPartnerLoads: () => listPartnerLoads,
    listPartnerOrgs: () => listPartnerOrgs,
    listPartnerShipments: () => listPartnerShipments,
    listPartners: () => listPartners,
    listPermissionsFor: () => listPermissionsFor,
    listPlugins: () => listPlugins,
    listPosts: () => listPosts,
    listRedirects: () => listRedirects,
    listRules: () => listRules,
    listSettlements: () => listSettlements,
    listStaffInvites: () => listStaffInvites,
    listTasks: () => listTasks,
    listTemplates: () => listTemplates,
    listThreads: () => listThreads,
    listTickets: () => listTickets,
    listTrips: () => listTrips,
    listWebhookDeliveries: () => listWebhookDeliveries,
    listWebhookEndpoints: () => listWebhookEndpoints,
    loadAdvisor: () => loadAdvisor,
    loadChecklist: () => loadChecklist,
    loadChecklistReview: () => loadChecklistReview,
    loadChecklistSet: () => loadChecklistSet,
    loadIntakeList: () => loadIntakeList,
    loadOffers: () => loadOffers,
    loadPickupStatus: () => loadPickupStatus,
    loadSetVerification: () => loadSetVerification,
    logException: () => logException,
    mailDraftDiscard: () => mailDraftDiscard,
    mailDraftSave: () => mailDraftSave,
    mailList: () => mailList,
    mailMark: () => mailMark,
    mailSend: () => mailSend,
    mailStats: () => mailStats,
    mailThread: () => mailThread,
    managementDashboard: () => managementDashboard,
    markMyNotification: () => markMyNotification,
    markNotification: () => markNotification,
    marketRpm: () => marketRpm,
    marketingIntel: () => marketingIntel,
    matchCarriers: () => matchCarriers,
    matchEligibility: () => matchEligibility,
    matchRank: () => matchRank,
    moduleSummary: () => moduleSummary,
    myAccountDeletionStatus: () => myAccountDeletionStatus,
    myApprovedPartners: () => myApprovedPartners,
    myAvailabilityStatus: () => myAvailabilityStatus,
    myAvatar: () => myAvatar,
    myBookRequests: () => myBookRequests,
    myCancellationRate: () => myCancellationRate,
    myCapacity: () => myCapacity,
    myCarrierOrg: () => myCarrierOrg,
    myDevices: () => myDevices,
    myDriverContext: () => myDriverContext,
    myFreeTrucks: () => myFreeTrucks,
    myHazmatReadiness: () => myHazmatReadiness,
    myNotifications: () => myNotifications,
    myOnboardingPacket: () => myOnboardingPacket,
    myPaymentProfile: () => myPaymentProfile,
    myPayoutRequests: () => myPayoutRequests,
    myRateConfirmation: () => myRateConfirmation,
    myRating: () => myRating,
    myReferral: () => myReferral,
    myReferralEarnings: () => myReferralEarnings,
    myReinstatements: () => myReinstatements,
    myServices: () => myServices,
    myStrikes: () => myStrikes,
    myTripIncidents: () => myTripIncidents,
    myTruckPostings: () => myTruckPostings,
    myTrustProfile: () => myTrustProfile,
    myWebhookCreate: () => myWebhookCreate,
    myWebhookDelete: () => myWebhookDelete,
    myWebhooks: () => myWebhooks,
    notifyBroadcast: () => notifyBroadcast,
    offerRespond: () => offerRespond,
    offerSend: () => offerSend,
    offersExpire: () => offersExpire,
    onboardingBoard: () => onboardingBoard,
    onboardingReviewItem: () => onboardingReviewItem,
    onboardingSubmitItem: () => onboardingSubmitItem,
    openDispute: () => openDispute,
    opsMap: () => opsMap,
    opsRadar: () => opsRadar,
    orgRating: () => orgRating,
    orgSetDocket: () => orgSetDocket,
    packetSetDates: () => packetSetDates,
    partner360: () => partner360,
    partnerAgentConfirm: () => partnerAgentConfirm,
    partnerAgentConfirmGet: () => partnerAgentConfirmGet,
    partnerAgentDecide: () => partnerAgentDecide,
    partnerAgentDeclare: () => partnerAgentDeclare,
    partnerAgentInvite: () => partnerAgentInvite,
    partnerAgentInviteRevoke: () => partnerAgentInviteRevoke,
    partnerAgentParentRemove: () => partnerAgentParentRemove,
    partnerAgentParentResend: () => partnerAgentParentResend,
    partnerAgentsList: () => partnerAgentsList,
    partnerAppointments: () => partnerAppointments,
    partnerBrokerScreen: () => partnerBrokerScreen,
    partnerCancelLoad: () => partnerCancelLoad,
    partnerCancellations: () => partnerCancellations,
    partnerCarrierCapacity: () => partnerCarrierCapacity,
    partnerCarrierDirectory: () => partnerCarrierDirectory,
    partnerCarrierPacket: () => partnerCarrierPacket,
    partnerCarrierReviews: () => partnerCarrierReviews,
    partnerChecklistSubmit: () => partnerChecklistSubmit,
    partnerClaimConfirm: () => partnerClaimConfirm,
    partnerClaimGet: () => partnerClaimGet,
    partnerClaims: () => partnerClaims,
    partnerComplianceBoard: () => partnerComplianceBoard,
    partnerCreateAppointment: () => partnerCreateAppointment,
    partnerEligibleCarriers: () => partnerEligibleCarriers,
    partnerEligibleDetail: () => partnerEligibleDetail,
    partnerExtendOffer: () => partnerExtendOffer,
    partnerGetProfile: () => partnerGetProfile,
    partnerIdentityRequestCall: () => partnerIdentityRequestCall,
    partnerIdentityResend: () => partnerIdentityResend,
    partnerIntakeOverview: () => partnerIntakeOverview,
    partnerLoadCancellations: () => partnerLoadCancellations,
    partnerLoadChangeRequest: () => partnerLoadChangeRequest,
    partnerLoadFull: () => partnerLoadFull,
    partnerLoadReview: () => partnerLoadReview,
    partnerLoadStatus: () => partnerLoadStatus,
    partnerMarkAllNotificationsRead: () => partnerMarkAllNotificationsRead,
    partnerMarkNotificationRead: () => partnerMarkNotificationRead,
    partnerMyInvoices: () => partnerMyInvoices,
    partnerMyLoads: () => partnerMyLoads,
    partnerMyShipments: () => partnerMyShipments,
    partnerNotifications: () => partnerNotifications,
    partnerOfferSend: () => partnerOfferSend,
    partnerOfferWithdraw: () => partnerOfferWithdraw,
    partnerOverview: () => partnerOverview,
    partnerPacketRemind: () => partnerPacketRemind,
    partnerPostLoad: () => partnerPostLoad,
    partnerRateableTrips: () => partnerRateableTrips,
    partnerRegister: () => partnerRegister,
    partnerRequestShipment: () => partnerRequestShipment,
    partnerRespondUpdate: () => partnerRespondUpdate,
    partnerReviewClaim: () => partnerReviewClaim,
    partnerSetAppointmentStatus: () => partnerSetAppointmentStatus,
    partnerSetStatus: () => partnerSetStatus,
    partnerShipperCompanyEmail: () => partnerShipperCompanyEmail,
    partnerShipperStatus: () => partnerShipperStatus,
    partnerShipperVerify: () => partnerShipperVerify,
    partnerSubmitInvoicePayment: () => partnerSubmitInvoicePayment,
    partnerSubmitLoad: () => partnerSubmitLoad,
    partnerTrackLoad: () => partnerTrackLoad,
    partnerTrustStatus: () => partnerTrustStatus,
    partnerUpdateLoad: () => partnerUpdateLoad,
    partnerUpdatePickup: () => partnerUpdatePickup,
    partnerUpdateProfile: () => partnerUpdateProfile,
    partnerUpdateRequests: () => partnerUpdateRequests,
    partnerVerifyCall: () => partnerVerifyCall,
    partnerVerifyCode: () => partnerVerifyCode,
    partnersAccounts: () => partnersAccounts,
    partnersOverview: () => partnersOverview,
    pauseCarrier: () => pauseCarrier,
    payAutopayDisable: () => payAutopayDisable,
    payAutopayStart: () => payAutopayStart,
    payAutopayStatus: () => payAutopayStatus,
    payConfirmReceived: () => payConfirmReceived,
    payDispute: () => payDispute,
    payDueItems: () => payDueItems,
    payInstructions: () => payInstructions,
    payMarkSent: () => payMarkSent,
    payMyTransfers: () => payMyTransfers,
    payRequestReminder: () => payRequestReminder,
    payTripMarkSent: () => payTripMarkSent,
    paymentProfilesQueue: () => paymentProfilesQueue,
    payrollAdd: () => payrollAdd,
    payrollDelete: () => payrollDelete,
    payrollList: () => payrollList,
    payrollMarkPaid: () => payrollMarkPaid,
    pipelineHealth: () => pipelineHealth,
    poaThread: () => poaThread,
    pocketAdvanceTrip: () => pocketAdvanceTrip,
    pocketAnnouncements: () => pocketAnnouncements,
    pocketAssignTrip: () => pocketAssignTrip,
    pocketAvailableLoads: () => pocketAvailableLoads,
    pocketBookLoad: () => pocketBookLoad,
    pocketCancelTrip: () => pocketCancelTrip,
    pocketCompliance: () => pocketCompliance,
    pocketConfirmTrip: () => pocketConfirmTrip,
    pocketDisputeInvoice: () => pocketDisputeInvoice,
    pocketDrivers: () => pocketDrivers,
    pocketFleetAlerts: () => pocketFleetAlerts,
    pocketGetPreferences: () => pocketGetPreferences,
    pocketGetProfile: () => pocketGetProfile,
    pocketInvoices: () => pocketInvoices,
    pocketMarkAllNotificationsRead: () => pocketMarkAllNotificationsRead,
    pocketMarkNotificationRead: () => pocketMarkNotificationRead,
    pocketMyExceptions: () => pocketMyExceptions,
    pocketMyIssues: () => pocketMyIssues,
    pocketNotifications: () => pocketNotifications,
    pocketOverview: () => pocketOverview,
    pocketPostLocation: () => pocketPostLocation,
    pocketRaiseIssue: () => pocketRaiseIssue,
    pocketReportIssue: () => pocketReportIssue,
    pocketSavePreferences: () => pocketSavePreferences,
    pocketSaveProfile: () => pocketSaveProfile,
    pocketSetConsent: () => pocketSetConsent,
    pocketSetMember: () => pocketSetMember,
    pocketStatement: () => pocketStatement,
    pocketSubmitOnboarding: () => pocketSubmitOnboarding,
    pocketTeam: () => pocketTeam,
    pocketTripDocs: () => pocketTripDocs,
    pocketTripPods: () => pocketTripPods,
    pocketTripTimeline: () => pocketTripTimeline,
    pocketTrips: () => pocketTrips,
    pocketTrucks: () => pocketTrucks,
    pocketUploadPod: () => pocketUploadPod,
    pocketUploadTripDoc: () => pocketUploadTripDoc,
    pocketUpsertDriver: () => pocketUpsertDriver,
    pocketUpsertTruck: () => pocketUpsertTruck,
    podReviewQueue: () => podReviewQueue,
    podSignedRef: () => podSignedRef,
    postChat: () => postChat,
    postMessage: () => postMessage,
    postTruck: () => postTruck,
    prebookCheck: () => prebookCheck,
    prefsProfileStrength: () => prefsProfileStrength,
    prefsSaveSection: () => prefsSaveSection,
    primeFlags: () => primeFlags,
    publicLoadOpportunities: () => publicLoadOpportunities,
    publicMarketRates: () => publicMarketRates,
    publishAgreement: () => publishAgreement,
    qboAuthUrl: () => qboAuthUrl,
    qboStatus: () => qboStatus,
    rateCounterparty: () => rateCounterparty,
    rateStandards: () => rateStandards,
    rateStandardsList: () => rateStandardsList,
    rateconDocument: () => rateconDocument,
    recordCarrierVerification: () => recordCarrierVerification,
    recordDocumentFile: () => recordDocumentFile,
    referralAccrue: () => referralAccrue,
    referralMarkPaid: () => referralMarkPaid,
    referralOverview: () => referralOverview,
    referralPayoutDecide: () => referralPayoutDecide,
    referralPayoutQueue: () => referralPayoutQueue,
    referralRequestPayout: () => referralRequestPayout,
    reinstatementQueue: () => reinstatementQueue,
    reminderCarrier: () => reminderCarrier,
    reminderSend: () => reminderSend,
    reminderSendCarrier: () => reminderSendCarrier,
    reminderTargets: () => reminderTargets,
    renderTemplate: () => renderTemplate,
    report: () => report,
    reportDelete: () => reportDelete,
    reportRun: () => reportRun,
    reportSave: () => reportSave,
    reportSetSchedule: () => reportSetSchedule,
    reportSnapshots: () => reportSnapshots,
    reportTripIncident: () => reportTripIncident,
    reportsList: () => reportsList,
    requestAccountAction: () => requestAccountAction,
    requestAccountDeletion: () => requestAccountDeletion,
    requestBookLoad: () => requestBookLoad,
    requestPacketCopies: () => requestPacketCopies,
    requestPoa: () => requestPoa,
    requestUpdate: () => requestUpdate,
    resolveAccountRequest: () => resolveAccountRequest,
    resolveDispute: () => resolveDispute,
    resolveException: () => resolveException,
    resolveUpdateRequest: () => resolveUpdateRequest,
    resolveViolation: () => resolveViolation,
    retryWebhookDelivery: () => retryWebhookDelivery,
    reviewAccessorial: () => reviewAccessorial,
    reviewDocument: () => reviewDocument,
    reviewPod: () => reviewPod,
    reviewReinstatement: () => reviewReinstatement,
    revokeApiKey: () => revokeApiKey,
    revokePushSubscription: () => revokePushSubscription,
    revokeRole: () => revokeRole,
    revokeStaffInvite: () => revokeStaffInvite,
    revokeStaffSessions: () => revokeStaffSessions,
    runComplianceExpirySweep: () => runComplianceExpirySweep,
    runStaleBookreqSweep: () => runStaleBookreqSweep,
    safetyIncidents: () => safetyIncidents,
    safetyScorecard: () => safetyScorecard,
    saveAudience: () => saveAudience,
    saveCustomForm: () => saveCustomForm,
    savePushSubscription: () => savePushSubscription,
    scanExpiring: () => scanExpiring,
    scanTruckMatches: () => scanTruckMatches,
    sendEmail: () => sendEmail,
    sendPush: () => sendPush,
    seoOverview: () => seoOverview,
    setAnnouncementActive: () => setAnnouncementActive,
    setBrandKit: () => setBrandKit,
    setBrokerVisibility: () => setBrokerVisibility,
    setCampaignActive: () => setCampaignActive,
    setCarrierStatus: () => setCarrierStatus,
    setCoiCoverage: () => setCoiCoverage,
    setCommTrigger: () => setCommTrigger,
    setCompliance: () => setCompliance,
    setCostAndLanes: () => setCostAndLanes,
    setCostModel: () => setCostModel,
    setDispatchPrefs: () => setDispatchPrefs,
    setEndpointActive: () => setEndpointActive,
    setFeatureFlag: () => setFeatureFlag,
    setFormStatus: () => setFormStatus,
    setIntegrationStatus: () => setIntegrationStatus,
    setInvoiceStatus: () => setInvoiceStatus,
    setLegalOwner: () => setLegalOwner,
    setLoadStatus: () => setLoadStatus,
    setMyAvatar: () => setMyAvatar,
    setMyPaymentProfile: () => setMyPaymentProfile,
    setMyServices: () => setMyServices,
    setOrgLogo: () => setOrgLogo,
    setPartnerInvoiceStatus: () => setPartnerInvoiceStatus,
    setPartnerStatus: () => setPartnerStatus,
    setPaymentInstructions: () => setPaymentInstructions,
    setPluginEnabled: () => setPluginEnabled,
    setPostStatus: () => setPostStatus,
    setPostingHos: () => setPostingHos,
    setRateStandard: () => setRateStandard,
    setRuleEnabled: () => setRuleEnabled,
    setSetting: () => setSetting,
    setStaffStatus: () => setStaffStatus,
    setThreadStatus: () => setThreadStatus,
    setTicketStatus: () => setTicketStatus,
    setTruckPostingAvailable: () => setTruckPostingAvailable,
    setUserPermission: () => setUserPermission,
    shipmentPipeline: () => shipmentPipeline,
    shipperMyShipments: () => shipperMyShipments,
    shipperPostLoad: () => shipperPostLoad,
    staffTrackLoad: () => staffTrackLoad,
    staffUploadDocument: () => staffUploadDocument,
    startOnboarding: () => startOnboarding,
    startTask: () => startTask,
    studioListTemplates: () => studioListTemplates,
    studioSaveTemplate: () => studioSaveTemplate,
    studioSetTemplateStatus: () => studioSetTemplateStatus,
    submitReinstatement: () => submitReinstatement,
    supportDecideClaim: () => supportDecideClaim,
    supportOverview: () => supportOverview,
    suppress: () => suppress,
    suppressionsList: () => suppressionsList,
    systemHealth: () => systemHealth,
    testEndpoint: () => testEndpoint,
    toggleRedirect: () => toggleRedirect,
    tripAccessorials: () => tripAccessorials,
    tripArrive: () => tripArrive,
    tripArriveGps: () => tripArriveGps,
    tripCheckin: () => tripCheckin,
    tripDepart: () => tripDepart,
    tripEmergencyRequest: () => tripEmergencyRequest,
    tripFinanceAdd: () => tripFinanceAdd,
    tripFinanceRemove: () => tripFinanceRemove,
    tripLocations: () => tripLocations,
    tripMyEmergencies: () => tripMyEmergencies,
    tripNotifyParties: () => tripNotifyParties,
    tripPickupStatus: () => tripPickupStatus,
    tripPnl: () => tripPnl,
    tripRevert: () => tripRevert,
    tripSetDriving: () => tripSetDriving,
    tripSetStopCoords: () => tripSetStopCoords,
    tripSetTracking: () => tripSetTracking,
    tripStopsProgress: () => tripStopsProgress,
    truckLoadingProfiles: () => truckLoadingProfiles,
    truckPostingMatches: () => truckPostingMatches,
    truckSetMaintenance: () => truckSetMaintenance,
    trustProfile: () => trustProfile,
    uninstallPlugin: () => uninstallPlugin,
    updateRequests: () => updateRequests,
    updateTruckPosting: () => updateTruckPosting,
    updateTruckPostingPlace: () => updateTruckPostingPlace,
    upsertCarrierSafety: () => upsertCarrierSafety,
    upsertDriver: () => upsertDriver,
    upsertKeyword: () => upsertKeyword,
    upsertPage: () => upsertPage,
    upsertPartner: () => upsertPartner,
    upsertPost: () => upsertPost,
    upsertTruck: () => upsertTruck,
    verificationQueue: () => verificationQueue,
    verifyPaymentProfile: () => verifyPaymentProfile,
    vinCoverage: () => vinCoverage,
    warnDriverExpiry: () => warnDriverExpiry,
    webAiReferrals: () => webAiReferrals,
    webLive: () => webLive,
    webOverview: () => webOverview,
    webPages: () => webPages,
    webReferrers: () => webReferrers,
    webhooksFlush: () => webhooksFlush,
    workflowRun: () => workflowRun,
    workflowRuns: () => workflowRuns,
    workflowSave: () => workflowSave,
    workflowSetStatus: () => workflowSetStatus,
    workflowsList: () => workflowsList
  });
  async function rpc(name, args) {
    const sb = await getClient();
    const { data, error } = await sb.rpc(name, args || {});
    if (error) {
      const e = new Error(error.message || "rpc " + name + " failed");
      e.code = error.code;
      e.details = error.details;
      e.rpc = name;
      e.hint = error.hint;
      if (typeof error.hint === "string" && error.hint.indexOf("DRIVER_DENIED") === 0) {
        e.driverDenied = true;
        e.perm = error.hint.split(":")[1] || null;
        try {
          if (name !== "cc_driver_log_denial") sb.rpc("cc_driver_log_denial", { p_rpc: name, p_perm: e.perm }).then(() => {
          }, () => {
          });
        } catch (_) {
        }
      }
      throw e;
    }
    return data;
  }
  async function adminUserUpdate(o) {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke("admin-user-update", { body: o });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  async function payAutopayStart() {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke("stripe-autopay", { body: {} });
    if (error) throw new Error(error.message || "Could not start bank authorisation");
    if (!data || !data.url) throw new Error(data && data.error || "Stripe did not return a setup link");
    return data.url;
  }
  async function _fnError(error, fallback) {
    let msg = error && error.message || fallback;
    try {
      const j = error && error.context && typeof error.context.json === "function" ? await error.context.json() : null;
      if (j && j.error) msg = j.error;
    } catch (_) {
    }
    return new Error(msg);
  }
  async function dialerToken() {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke("telnyx-token", { body: {} });
    if (error) throw await _fnError(error, "Could not reach the phone service");
    return data;
  }
  async function dialerClaimWaiting() {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke("telnyx-token", { body: { claim: true } });
    if (error) return { claimed: false };
    return data || { claimed: false };
  }
  async function dialerRecordingBlob(callId) {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke("telnyx-recording", { body: { call_id: callId } });
    if (error) throw await _fnError(error, "Recording not available");
    if (!(data instanceof Blob)) throw new Error(data && data.error || "Recording not available");
    return new Blob([data], { type: "audio/mpeg" });
  }
  async function dialerSmsSend(to, body) {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke("telnyx-sms", { body: { to, body } });
    if (error) throw await _fnError(error, "Could not send that text");
    return data;
  }
  async function dmailAct(body) {
    const sb = await getClient();
    if (body && body.action === "attachment") {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(sb.supabaseUrl + "/functions/v1/dmail", { method: "POST", headers: { "Content-Type": "application/json", apikey: sb.supabaseKey, Authorization: "Bearer " + (session && session.access_token || "") }, body: JSON.stringify(body) });
      if (!r.ok) {
        let m = "Could not download that file";
        try {
          m = (await r.json()).error || m;
        } catch (_) {
        }
        throw new Error(m);
      }
      return await r.blob();
    }
    const { data, error } = await sb.functions.invoke("dmail", { body });
    if (error) throw await _fnError(error, "The mail service is unreachable");
    if (data && !(data instanceof Blob) && data.error) throw new Error(data.error);
    return data;
  }
  var getMyStaffContext, getStaffDirectory, getRolesCatalog, getAuditLogs, _flagMap, _flagPromise, primeFlags, isFlagEnabled, getFeatureFlags, setFeatureFlag, getSetting, setSetting, getOverviewStats, setBrokerVisibility, getBrokerVisibility, submitReinstatement, poaThread, myReinstatements, reinstatementQueue, healthAdjust, healthResetFactor, myStrikes, carrierPoaDemands, requestPoa, carrierReinstatements, reviewReinstatement, pauseCarrier, getCarriersDirectory, getCarrierDetail, getLoadsList, getLoadDetail, getDocumentsQueue, setCarrierStatus, createLoad, LOAD_SOURCE_TYPES, createLoadSourced, loadIntakeList, loadSetVerification, matchEligibility, matchRank, offerSend, loadOffers, carrierOffers, offerRespond, offersExpire, bookingStatus, tripSetTracking, tripCheckin, controlTower, partnerLoadStatus, loadAdvisor, setDispatchPrefs, getDispatchPrefs, carrierBestLoads, dispatchPlan, myReferral, claimReferral, myReferralEarnings, referralAccrue, referralOverview, referralMarkPaid, referralRequestPayout, myPayoutRequests, referralPayoutQueue, setMyServices, myServices, accountHealth, rateCounterparty, myRating, carrierRateableTrips, orgRating, partnerRateableTrips, postTruck, myTruckPostings, truckPostingMatches, updateTruckPosting, confirmTruckPosting, myAvailabilityStatus, updateTruckPostingPlace, setTruckPostingAvailable, setPostingHos, scanTruckMatches, expenseAdd, expenseList, expenseDelete, iftaSet, iftaSummary, truckSetMaintenance, fleetMaintenance, adminNote, bookRequestCarrierPacket, accountHealthBoard, issueViolation, documentFile, resolveViolation, assignShipment, brokerShipmentInbox, brokerQuoteShipment, deliveryDocPack, prebookCheck, dispatchSheet, myRateConfirmation, acknowledgeRC, currentAgreement, acceptAgreement, publishAgreement, myOnboardingPacket, onboardingSubmitItem, onboardingReviewItem, partnerSetStatus, partnersAccounts, partner360, onboardingBoard, shipperPostLoad, brokerClaimShipment, brokerTenderShipment, shipperMyShipments, shipmentPipeline, brokerViewCarrier, carrierViewPoster, setMyPaymentProfile, myPaymentProfile, paymentProfilesQueue, verifyPaymentProfile, carrierPaymentProfile, carrierFactoringSet, carrierFactoringRemitUpdate, ccFactoringVerify, ccOnboardingRemind, ccOnboardingReminderStatus, ccFleetTruckRemind, ccFleetTruckReminderStatus, carrierFactoringPacket, carrierFactoringBrokers, carrierFactoringBrokerSet, payTripMarkSent, payRequestReminder, carrierEldSetup, carrierEldStatus, carrierEldDisconnect, carrierAccountingExport, carrierFuelImport, carrierAssignSuggestions, carrierFleetPlan, carrierFleetOptimization, qboAuthUrl, qboStatus, trustProfile, myTrustProfile, myHazmatReadiness, myApprovedPartners, marketingIntel, rateStandards, setRateStandard, rateStandardsList, ccCarrierBackoffice, referralPayoutDecide, biExecutiveSummary, biTimeseries, reportsList, reportSave, reportDelete, reportRun, reportSnapshots, carrierScorecard, carrierScorecardRanking, brokerSla, brokerSlaRanking, myNotifications, markMyNotification, notifyBroadcast, reportSetSchedule, carrierDashboard, carrierLoadDetail, tripEmergencyRequest, tripMyEmergencies, emergencyReview, emergencyQueue, fleetServiceAdd, fleetServiceList, fleetServiceDelete, payrollAdd, payrollList, payrollMarkPaid, payrollDelete, workflowSave, workflowSetStatus, workflowsList, workflowRun, workflowRuns, financeReceivables, financePayables, invoicePrepQueue, financeReconcile, carrierPnl, carrierAddExpense, carrierExpenses, carrierDeleteExpense, partnerChecklistSubmit, loadChecklistReview, requestUpdate, updateRequests, partnerUpdateRequests, partnerRespondUpdate, resolveUpdateRequest, tripArrive, tripArriveGps, tripSetStopCoords, carrierRequestAccessorial, tripAccessorials, pocketCancelTrip, cancelPreview, tripPickupStatus, myCancellationRate, partnerEligibleCarriers, partnerOfferSend, partnerCancelLoad, partnerLoadCancellations, partnerCancellations, pocketUploadTripDoc, claimBundle, partnerClaims, partnerReviewClaim, claimEscalate, supportDecideClaim, payInstructions, payMarkSent, payConfirmReceived, payMyTransfers, ccPayPendingFees, payDueItems, payDispute, ccLoadStops, tripStopsProgress, agentCarrierDirectory, agentChainStatus, agentFeed, agentOnboardingStatus, agentSaveOnboarding, ccAgentsQueue, ccAgentDecide, isMyOrgAgent, agentPayoutCenter, agentRequestPayout, agentConfirmPayoutReceived, agentSendInvite, agentMsgSend, agentMsgList, ccAgentMsgs, ccAgentMsgSend, agentClaimUpline, ccAgentsList, ccAgent360, ccAgentNotifySend, ccAgentDocReview, partnerPacketRemind, prefsProfileStrength, prefsSaveSection, requestAccountDeletion, cancelAccountDeletion, myAccountDeletionStatus, ccAccountDeletionQueue, ccAccountDeletionProcess, ccAgentPayoutVerify, ccAgentPayoutRequestDetails, ccAgentPayoutApproveMethod, dispatcherApply, dispatcherSubmitId, dispatcherTestMy, dispatcherTestStart, dispatcherTestSave, dispatcherTestSubmit, ccDispatcherTestInvite, ccDispatcherTestReview, ccDispatcherTestScore, ccDispatcherTestSendScore, dispatcherMyStatus, dispatcherReapply, ccDispatchersList, ccDispatchersPage, ccDispatchersStats, ccDispatchersBoard, ccDispatcherPayouts, ccDispatcherActivity, ccDispatcher360, ccDispatcherDecide, ccDispatcherAssign, ccDispatcherSop, ccDispatcherUnassign, ccDispatcherSalarySet, ccDispatcherSalaryRun, ccDispatcherSalaryStatus, ccCarrierPrefs, dispatcherWorkspaceFeed, dispatcherSetAvailability, dispatcherLogBooking, dispatcherBookingUpdate, dispatcherBookingEvent, dispatcherBookingTimeline, dispatcherBrokerUpsert, dispatcherBrokerDelete, dispatcherThreadList, dispatcherThreadSend, carrierMyDispatcher, ccDispatcherSetTerms, ccDispatcherBookings, ccDispatcherBookingDecide, ccDispatcherCommissionStatus, ccDispatcherCommissionList, dispatcherThreadMarkRead, ccDispatcherQueue, ccDispatcherCommissionPay, carrierMyDispatcherBookings, carrierDispatcherAck, carrierDispatcherPause, ccDispatcherResendIntro, carrierBookingAck, dispatcherBoard, dispatcherLoadDetail, dispatcherRequestBook, dispatcherPostTruck, dispatcherUpdatePosting, dispatcherPostingMatches, dispatcherMyKpis, ccDispatcherKpis, dispatcherTrip, dispatcherTripAction, partnerUpdateLoad, partnerLoadChangeRequest, ccOutreachStats, ccOutreachCrm, ccOutreachControl, ccOutreachToday, ccOutreachTemplates, ccOutreachTemplatePreview, ccOutreachTemplateSave, ccOutreachLog, ccOutreachLogPage, ccOutreachAudience, ccLcList, ccLcGet, ccLcReply, ccLcSetStatus, ccLcStats, ccLcMisses, ccLcTeach, ccLcMissDismiss, ccLcAssign, ccLcCannedList, ccLcCannedSave, ccLcCannedDelete, ccRetellCallback, ccLcCalls, ccLcPresenceGet, ccLcPresenceSet, ccLcHeartbeat, ccLcTyping, ccLcBotResume, reviewAccessorial, accessorialQueue, tripDepart, detentionScan, exceptionCenter, reviewDocument, coiPanel, staffUploadDocument, documentProvenance, requestAccountAction, accountRequests, resolveAccountRequest, setCoiCoverage, assignRole, revokeRole, setStaffStatus, revokeStaffSessions, assignLoad, setLoadStatus, listTasks, completeTask, startTask, invoiceVoid, invoiceCredit, tripRevert, agentSuspend, invoiceSendReminder, invoiceLookup, feeInvoiceQueue, feeInvoiceApprove, feeInvoiceReject, payAutopayStatus, payAutopayDisable, tripNotifyParties, automationHealth, crmOverview, crmListLeads, crmGetLead, crmCreateLead, crmSetLeadStage, crmAddActivity, complianceOverview, listOnboarding, getCarrierCompliance, startOnboarding, setCompliance, decideOnboarding, scanExpiring, dispatchOverview, listTrips, getTrip, createTrip, advanceTrip, addTripNote, mailStats, mailList, mailThread, mailMark, mailDraftSave, mailDraftDiscard, mailSend, commOverview, listThreads, getThread, createThread, postMessage, setThreadStatus, listNotifications, markNotification, listTemplates, financeOverview, financeAnalytics, listModules, moduleSummary, systemHealth, cmpList, cmpSave, cmpSetStatus, cmpMarkSent, reminderTargets, reminderSend, reminderCarrier, reminderSendCarrier, formProgressPing, formProgressDone, campaignAudiencePreview, campaignEnqueue, campaignApprove, campaignVariants, campaignSetVariant, campaignDeleteVariant, campaignVariantAnalytics, deliveryClaim, deliveryMark, suppress, deliveryHealth, pipelineHealth, commTriggers, setCommTrigger, campaignAnalytics, campaignAttribution, enqueueTransactional, deliveryReleaseDue, deliveryList, suppressionsList, audienceEstimate, listAudiences, saveAudience, deleteAudience, AUDIENCE_TYPES, studioListTemplates, studioSaveTemplate, studioSetTemplateStatus, renderTemplate, TEMPLATE_VARIABLES, listWebhookEndpoints, listWebhookDeliveries, retryWebhookDelivery, webhooksFlush, eventCatalog, listInvoices, getInvoice, createInvoice, setInvoiceStatus, listSettlements, createSettlement, decideSettlement, analyticsOverview, analyticsRevenue, analyticsOps, analyticsCarriers, contentOverview, listPosts, getPost, upsertPost, setPostStatus, listPages, upsertPage, integrationsOverview, listIntegrations, listEndpoints, myWebhooks, myWebhookCreate, myWebhookDelete, createEndpoint, setEndpointActive, testEndpoint, listDeliveries, pocketOverview, myCarrierOrg, pocketTrips, pocketInvoices, pocketCompliance, carrierRequestReverify, carrierSignAgreement, carrierAgreementSignature, carrierSubmitW9, carrierW9, pocketConfirmTrip, pocketRaiseIssue, pocketMyIssues, publicLoadOpportunities, pocketAvailableLoads, pocketBookLoad, requestBookLoad, tripPnl, tripFinanceAdd, tripFinanceRemove, carrierEarnings, getCostModel, setCostModel, partnerUpdatePickup, myBookRequests, bookRequestsQueue, decideBookRequest, pocketNotifications, pocketMarkNotificationRead, pocketGetPreferences, pocketSavePreferences, consentSummary, pocketGetProfile, pocketSubmitOnboarding, pocketSaveProfile, carrierUploadDocument, carrierListDocuments, pocketReportIssue, pocketDisputeInvoice, pocketUploadPod, pocketTripPods, pocketDrivers, carrierLinkDriver, pocketUpsertDriver, pocketTrucks, coiVehicles, pocketUpsertTruck, vinCoverage, fleetFmcsaCheck, setLegalOwner, truckLoadingProfiles, breakeven, setCostAndLanes, pocketTeam, pocketSetMember, pocketAssignTrip, pocketStatement, pocketFleetAlerts, pocketAdvanceTrip, pocketTripTimeline, pocketMyExceptions, savePushSubscription, revokePushSubscription, VAPID_PUBLIC_KEY, sendPush, opsRadar, matchCarriers, globalSearch, fleetOverview, listDrivers, fleetExpiryBoard, partnerComplianceBoard, packetSetDates, authorityBoard, orgSetDocket, contactsDirectory, warnDriverExpiry, listPermissionsFor, setUserPermission, inviteStaff, listStaffInvites, revokeStaffInvite, claimStaffInvite, upsertDriver, upsertTruck, assignTripResources, addAccessorial, logException, listExceptions, resolveException, upsertCarrierSafety, safetyScorecard, addAdjustment, openDispute, resolveDispute, exportFinance, carrierStatement, pocketSetConsent, pocketPostLocation, tripSetDriving, tripLocations, laneHistory, managementDashboard, invoiceDocument, rateconDocument, listDocumentFiles, recordDocumentFile, podReviewQueue, podSignedRef, reviewPod, webLive, webOverview, webPages, webReferrers, webAiReferrals, formsOverview, listForms, getForm, convertFormToLead, setFormStatus, seoOverview, listKeywords, upsertKeyword, listRedirects, createRedirect, toggleRedirect, integrationStatus, setIntegrationStatus, carrier360, entityAudit, partnersOverview, listPartners, getPartner, upsertPartner, setPartnerStatus, supportOverview, listTickets, getTicket, createTicket, setTicketStatus, report, listRules, setRuleEnabled, actionCenter, opsMap, ga4Insights, gscInsights, ccEmailLoads, ccEmailBrokerVerify, createAnnouncement, listAnnouncements, setAnnouncementActive, pocketAnnouncements, createCampaign, listCampaigns, setCampaignActive, aiAssist, sendEmail, fmcsaVerify, listCarrierOrgs, postChat, listChat, partnerRegister, partnerBrokerScreen, partnerAgentDeclare, partnerTrustStatus, partnerAgentConfirmGet, partnerAgentConfirm, ccBrokerTrustQueue, ccBrokerTrustSet, partnerIdentityResend, partnerIdentityRequestCall, partnerAgentsList, partnerAgentDecide, partnerAgentInvite, partnerAgentInviteRevoke, partnerAgentParentRemove, partnerAgentParentResend, partnerShipperStatus, partnerShipperVerify, partnerShipperCompanyEmail, ccShipperTrustQueue, ccShipperTrustSet, partnerClaimGet, partnerClaimConfirm, partnerVerifyCall, partnerVerifyCode, partnerOverview, partnerPostLoad, partnerMyLoads, partnerSubmitLoad, partnerCarrierDirectory, partnerCarrierCapacity, loadPickupStatus, myCapacity, myFreeTrucks, partnerCarrierReviews, partnerLoadFull, partnerTrackLoad, pocketTripDocs, partnerEligibleDetail, requestPacketCopies, partnerCarrierPacket, ccAskReschedule, partnerExtendOffer, partnerOfferWithdraw, marketRpm, laneRate, publicMarketRates, setOrgLogo, loadChecklist, loadChecklistSet, partnerRequestShipment, partnerMyShipments, partnerCreateAppointment, partnerAppointments, partnerSetAppointmentStatus, partnerIntakeOverview, listPartnerLoads, decidePartnerLoad, partnerLoadReview, listPartnerShipments, decidePartnerShipment, listPartnerAppointmentsAll, createPartnerInvoice, listPartnerInvoicesAll, setPartnerInvoiceStatus, partnerMyInvoices, listPartnerOrgs, partnerNotifications, partnerMarkNotificationRead, partnerMarkAllNotificationsRead, pocketMarkAllNotificationsRead, partnerGetProfile, partnerUpdateProfile, createApiKey, listApiKeys, revokeApiKey, getPaymentInstructions, setPaymentInstructions, partnerSubmitInvoicePayment, recordCarrierVerification, listCarrierVerifications, verificationQueue, getBrandKit, setBrandKit, saveCustomForm, listCustomForms, listPlugins, listInstalledPlugins, installPlugin, setPluginEnabled, uninstallPlugin, api_default, setMyAvatar, myAvatar, runComplianceExpirySweep, runStaleBookreqSweep, emergencyContacts, emergencyContactAdd, emergencyContactDelete, reportTripIncident, myTripIncidents, safetyIncidents, ackIncident, approveIncidentReschedule, fuelPricesGet, deviceSeen, myDevices, facilityReviewSubmit, facilityRatings, staffTrackLoad, ccCarrierFleet360, driverPermissionCatalog, driverAccessList, carrierInviteDriver, driverInviteResend, driverInviteRevoke, driverInvitePeek, acceptDriverInvite, driverGrantsGet, driverGrantsSet, driverSetStatus, driverOrgSettings, driverDocsForOwner, driverDocReview, myDriverContext, driverHeartbeat, driverUpdateMyProfile, driverMyDocs, driverDocUpload, driverMyEarnings, driverMySettlements, ccCarrierDriverAccess, ccDriverAdoptionKpis, dialerBootstrap, dialerHeartbeat, dialerForwardSet, dialerLookup, dialerCallStart, dialerCallUpdate, dialerCallTag, dialerCallbackSet, dialerHistory, ccDialerOverview, ccDialerCalls, dialerSmsThreads, dialerSmsThread, ccDialerSms, ccDialerLineUpsert, ccDialerLineRelease, ccDialerConfigSet, dmailBootstrap, dmailList, dmailThread, dmailDraftSave, dmailDraftDiscard, dmailPoll, dmailContacts, ccDmailOverview, ccDmailActivity, ccDmailAccountSave, ccDmailAssign, ccDmailSetStatus;
  var init_api = __esm({
    "mnt/loadboot/app/shared/api.js"() {
      init_supabaseClient();
      getMyStaffContext = () => rpc("get_my_staff_context");
      getStaffDirectory = () => rpc("get_staff_directory");
      getRolesCatalog = () => rpc("get_roles_catalog");
      getAuditLogs = (opts = {}) => rpc("get_audit_logs", {
        p_limit: opts.limit ?? 50,
        p_before_id: opts.beforeId ?? null,
        p_action: opts.action ?? null,
        p_target_type: opts.targetType ?? null,
        p_target_org_id: opts.targetOrgId ?? null
      });
      _flagMap = null;
      _flagPromise = null;
      primeFlags = () => {
        if (_flagMap) return Promise.resolve(_flagMap);
        if (!_flagPromise) {
          _flagPromise = rpc("all_flags").then((m) => {
            _flagMap = m && typeof m === "object" ? m : {};
            return _flagMap;
          }).catch(() => {
            _flagPromise = null;
            return null;
          });
        }
        return _flagPromise;
      };
      isFlagEnabled = async (key) => {
        const m = await primeFlags();
        if (m) return m[key] === true;
        return rpc("is_flag_enabled", { p_key: key });
      };
      getFeatureFlags = () => rpc("get_feature_flags");
      setFeatureFlag = (key, enabled, opts = {}) => rpc("set_feature_flag", {
        p_key: key,
        p_enabled: enabled,
        p_reason: opts.reason ?? null,
        p_expires_at: opts.expiresAt ?? null
      });
      getSetting = (key) => rpc("get_setting", { p_key: key });
      setSetting = (key, value) => rpc("set_setting", { p_key: key, p_value: value });
      getOverviewStats = () => rpc("cc_get_overview");
      setBrokerVisibility = (org, visible, note) => rpc("cc_set_broker_visibility", { p_org: org, p_visible: visible, p_note: note ?? null });
      getBrokerVisibility = (org) => rpc("cc_get_broker_visibility", { p_org: org });
      submitReinstatement = (message, attachments, kind) => rpc("cc_pocket_submit_reinstatement", { p_message: message, p_attachments: attachments ?? [], p_kind: kind ?? "reinstate" });
      poaThread = (kind) => rpc("cc_pocket_poa_thread", { p_kind: kind ?? "health_poa" });
      myReinstatements = () => rpc("cc_pocket_my_reinstatements", {});
      reinstatementQueue = () => rpc("cc_reinstatement_queue", {});
      healthAdjust = (org, factor, points, reason, fix, expiresDays) => rpc("cc_health_adjust", { p_org: org, p_factor: factor ?? null, p_points: points, p_reason: reason, p_fix: fix ?? null, p_expires_days: expiresDays ?? null });
      healthResetFactor = (org, factorKey, reason) => rpc("cc_health_reset_factor", { p_org: org, p_factor_key: factorKey, p_reason: reason });
      myStrikes = () => rpc("cc_pocket_my_strikes", {});
      carrierPoaDemands = (org) => rpc("cc_carrier_poa_demands", { p_org: org });
      requestPoa = (org, factor, note) => rpc("cc_request_poa", { p_org: org, p_factor: factor, p_note: note ?? null });
      carrierReinstatements = (org) => rpc("cc_carrier_reinstatements", { p_org: org });
      reviewReinstatement = (id, action, note) => rpc("cc_review_reinstatement", { p_id: id, p_action: action, p_note: note ?? null });
      pauseCarrier = (org, action, scope, reason) => rpc("cc_pause_carrier", { p_org: org, p_action: action, p_scope: scope ?? "all", p_reason: reason ?? null });
      getCarriersDirectory = (o = {}) => rpc("cc_list_carriers", {
        p_search: o.search ?? null,
        p_status: o.status ?? null,
        p_limit: o.limit ?? 100
      });
      getCarrierDetail = (id) => rpc("cc_get_carrier", { p_carrier: id });
      getLoadsList = (o = {}) => rpc("cc_list_loads", {
        p_search: o.search ?? null,
        p_status: o.status ?? null,
        p_limit: o.limit ?? 200
      });
      getLoadDetail = (id) => rpc("cc_get_load", { p_load: id });
      getDocumentsQueue = (o = {}) => rpc("cc_list_documents", {
        p_status: o.status ?? "pending",
        p_limit: o.limit ?? 100
      });
      setCarrierStatus = (carrierId, status, note) => rpc("cc_set_carrier_status", { p_carrier: carrierId, p_status: status, p_note: note ?? null });
      createLoad = (o = {}) => rpc("cc_create_load", {
        p_origin: o.origin,
        p_destination: o.destination,
        p_equipment: o.equipment ?? null,
        p_rate: o.rate ?? null,
        p_miles: o.miles ?? null,
        p_commodity: o.commodity ?? null,
        p_pickup_date: o.pickupDate ?? null
      });
      LOAD_SOURCE_TYPES = [["partner_portal", "Partner portal"], ["staff_entered", "Staff entered"], ["licensed_integration", "Licensed integration"], ["official_api", "Official API"], ["uploaded_document", "Uploaded document"], ["imported", "Imported (CSV)"], ["unverified_external", "Unverified external"], ["quote_converted", "Quote converted"], ["recurring_lane", "Recurring lane"], ["duplicated", "Duplicated"], ["api_client", "API client"]];
      createLoadSourced = (o = {}) => rpc("cc_create_load_sourced", { p: o });
      loadIntakeList = (o = {}) => rpc("cc_load_intake_list", { p_source: o.source ?? null, p_verification: o.verification ?? null, p_status: o.status ?? null, p_limit: o.limit ?? 200 });
      loadSetVerification = (id, verification, confidence) => rpc("cc_load_set_verification", { p_load: id, p_verification: verification, p_confidence: confidence ?? null });
      matchEligibility = (loadId) => rpc("cc_match_eligibility", { p_load: loadId });
      matchRank = (loadId) => rpc("cc_match_rank", { p_load: loadId });
      offerSend = (loadId, carriers, rate, expiryMinutes) => rpc("cc_offer_send", { p_load: loadId, p_carriers: carriers, p_rate: rate ?? null, p_expiry_minutes: expiryMinutes ?? 60 });
      loadOffers = (loadId) => rpc("cc_load_offers", { p_load: loadId });
      carrierOffers = (limit) => rpc("cc_carrier_offers", { p_limit: limit ?? 50 });
      offerRespond = (offerId, action, o = {}) => rpc("cc_offer_respond", { p_offer: offerId, p_action: action, p_reason: o.reason ?? null, p_counter: o.counter ?? null, p_message: o.message ?? null });
      offersExpire = () => rpc("cc_offers_expire");
      bookingStatus = (loadId) => rpc("cc_booking_status", { p_load: loadId });
      tripSetTracking = (tripId, method) => rpc("cc_trip_set_tracking", { p_trip: tripId, p_method: method });
      tripCheckin = (tripId, o = {}) => rpc("cc_trip_checkin", { p_trip: tripId, p_lat: o.lat ?? null, p_lng: o.lng ?? null, p_note: o.note ?? null, p_source: o.source ?? "manual_checkin" });
      controlTower = (limit) => rpc("cc_control_tower", { p_limit: limit ?? 100 });
      partnerLoadStatus = (partnerLoadId) => rpc("cc_partner_load_status", { p_partner_load: partnerLoadId });
      loadAdvisor = (loadId, overrides) => rpc("cc_load_advisor", { p_load: loadId, p_overrides: overrides ?? {} });
      setDispatchPrefs = (o) => rpc("cc_set_dispatch_prefs", { p: o ?? {} });
      getDispatchPrefs = () => rpc("cc_get_dispatch_prefs");
      carrierBestLoads = (carrierId, limit) => rpc("cc_carrier_best_loads", { p_carrier: carrierId ?? null, p_limit: limit ?? 10 });
      dispatchPlan = (maxLoads) => rpc("cc_dispatch_plan", { p_max_loads: maxLoads ?? 20 });
      myReferral = () => rpc("cc_my_referral");
      claimReferral = (code) => rpc("cc_claim_referral", { p_code: code });
      myReferralEarnings = (limit) => rpc("cc_my_referral_earnings", { p_limit: limit ?? 100 });
      referralAccrue = () => rpc("cc_referral_accrue");
      referralOverview = () => rpc("cc_referral_overview");
      referralMarkPaid = (code) => rpc("cc_referral_mark_paid", { p_referrer_code: code });
      referralRequestPayout = (details) => rpc("cc_referral_request_payout", { p_details: details });
      myPayoutRequests = () => rpc("cc_my_payout_requests");
      referralPayoutQueue = (status) => rpc("cc_referral_payout_queue", { p_status: status || "open" });
      setMyServices = (arr) => rpc("cc_set_my_services", { p_services: arr });
      myServices = () => rpc("cc_my_services");
      accountHealth = (org) => rpc("cc_account_health", { p_org: org ?? null });
      rateCounterparty = (trip, stars, comment) => rpc("cc_rate_counterparty", { p_trip: trip, p_stars: stars, p_comment: comment ?? null });
      myRating = () => rpc("cc_my_rating");
      carrierRateableTrips = (limit) => rpc("cc_carrier_rateable_trips", { p_limit: limit ?? 10 });
      orgRating = (org) => rpc("cc_org_rating", { p_org: org });
      partnerRateableTrips = (limit = 20) => rpc("cc_partner_rateable_trips", { p_limit: limit });
      postTruck = (o) => rpc("cc_post_truck", { p: o ?? {} });
      myTruckPostings = () => rpc("cc_my_truck_postings");
      truckPostingMatches = (id) => rpc("cc_truck_posting_matches", { p_posting: id });
      updateTruckPosting = (id, action, patch = null) => rpc("cc_update_truck_posting", { p_id: id, p_action: action, p_patch: patch });
      confirmTruckPosting = (id) => rpc("cc_confirm_truck_posting", { p_id: id });
      myAvailabilityStatus = () => rpc("cc_my_availability_status");
      updateTruckPostingPlace = (id, p) => rpc("cc_update_truck_posting_place", { p_id: id, p: p ?? {} });
      setTruckPostingAvailable = (id, available) => rpc("cc_set_truck_posting_available", { p_id: id, p_available: !!available });
      setPostingHos = (id, hours, source) => rpc("cc_set_posting_hos", {
        p_id: id,
        p_hours: hours === "" || hours == null ? null : Number(hours),
        p_source: source || "carrier"
      });
      scanTruckMatches = () => rpc("cc_scan_truck_matches");
      expenseAdd = (o) => rpc("cc_expense_add", { p: o ?? {} });
      expenseList = (month) => rpc("cc_expense_list", { p_month: month ?? null });
      expenseDelete = (id) => rpc("cc_expense_delete", { p_id: id });
      iftaSet = (q, st, mi, gal) => rpc("cc_ifta_set", { p_quarter: q, p_state: st, p_miles: mi, p_gallons: gal ?? null });
      iftaSummary = (q) => rpc("cc_ifta_summary", { p_quarter: q });
      truckSetMaintenance = (id, service, insp) => rpc("cc_truck_set_maintenance", { p_truck: id, p_service: service ?? null, p_inspection: insp ?? null });
      fleetMaintenance = () => rpc("cc_fleet_maintenance");
      adminNote = (action, target, note) => rpc("cc_admin_note", { p_action: action, p_target: target, p_note: note ?? null });
      bookRequestCarrierPacket = (id) => rpc("cc_book_request_carrier_packet", { p_request: id });
      accountHealthBoard = (limit = 100) => rpc("cc_account_health_board", { p_limit: limit });
      issueViolation = (org, kind, severity, note) => rpc("cc_issue_violation", { p_org: org, p_kind: kind, p_severity: severity, p_note: note });
      documentFile = (id) => rpc("cc_document_file", { p_document: id });
      resolveViolation = (id, note) => rpc("cc_resolve_violation", { p_id: id, p_note: note ?? null });
      assignShipment = (id, broker) => rpc("cc_assign_shipment", { p_id: id, p_broker: broker });
      brokerShipmentInbox = () => rpc("cc_broker_shipment_inbox");
      brokerQuoteShipment = (id, amount, note) => rpc("cc_broker_quote_shipment", { p_id: id, p_amount: amount, p_note: note ?? null });
      deliveryDocPack = (trip) => rpc("cc_delivery_doc_pack", { p_trip: trip });
      prebookCheck = (load, carrier) => rpc("cc_prebook_check", { p_load: load, p_carrier: carrier ?? null });
      dispatchSheet = (trip) => rpc("cc_dispatch_sheet", { p_trip: trip });
      myRateConfirmation = (trip) => rpc("cc_my_rate_confirmation", { p_trip: trip });
      acknowledgeRC = (trip) => rpc("cc_acknowledge_rate_confirmation", { p_trip: trip });
      currentAgreement = (kind) => rpc("cc_current_agreement", { p_kind: kind });
      acceptAgreement = (kind) => rpc("cc_accept_agreement", { p_kind: kind });
      publishAgreement = (kind, version, legalOk) => rpc("cc_publish_agreement", { p_kind: kind, p_version: version, p_legal_ok: legalOk });
      myOnboardingPacket = () => rpc("cc_my_onboarding_packet");
      onboardingSubmitItem = (key, ref, note) => rpc("cc_onboarding_submit_item", { p_key: key, p_ref: ref, p_note: note ?? null });
      onboardingReviewItem = (org, key, action, note) => rpc("cc_onboarding_review_item", { p_org: org, p_key: key, p_action: action, p_note: note ?? null });
      partnerSetStatus = (org, action, reason) => rpc("cc_partner_set_status", { p_org: org, p_action: action, p_reason: reason ?? null });
      partnersAccounts = () => rpc("cc_partners_accounts", {});
      partner360 = (org) => rpc("cc_partner_360", { p_org: org });
      onboardingBoard = (kind) => rpc("cc_onboarding_board", { p_kind: kind ?? null });
      shipperPostLoad = (p) => rpc("cc_shipper_post_load", { p });
      brokerClaimShipment = (id) => rpc("cc_broker_claim_shipment", { p_id: id });
      brokerTenderShipment = (id, rate, acc) => rpc("cc_broker_tender_shipment", { p_id: id, p_rate: rate, p_accessorials: acc });
      shipperMyShipments = () => rpc("cc_shipper_my_shipments");
      shipmentPipeline = () => rpc("cc_shipment_pipeline");
      brokerViewCarrier = (carrier) => rpc("cc_broker_view_carrier", { p_carrier: carrier });
      carrierViewPoster = (load) => rpc("cc_carrier_view_poster", { p_load: load });
      setMyPaymentProfile = (p) => rpc("cc_set_my_payment_profile", { p });
      myPaymentProfile = () => rpc("cc_my_payment_profile");
      paymentProfilesQueue = (status) => rpc("cc_payment_profiles_queue", { p_status: status || "unverified" });
      verifyPaymentProfile = (org, ok, note) => rpc("cc_verify_payment_profile", { p_org: org, p_ok: ok, p_note: note ?? null });
      carrierPaymentProfile = (org) => rpc("cc_carrier_payment_profile", { p_org: org });
      carrierFactoringSet = (p) => rpc("carrier_factoring_set", { p });
      carrierFactoringRemitUpdate = (p) => rpc("carrier_factoring_remit_update", { p });
      ccFactoringVerify = (org, ok, note) => rpc("cc_factoring_verify", { p_org: org, p_ok: ok, p_note: note ?? null });
      ccOnboardingRemind = (org, doc) => rpc("cc_onboarding_remind", { p_org: org, p_doc: doc ?? null });
      ccOnboardingReminderStatus = (org) => rpc("cc_onboarding_reminder_status", { p_org: org });
      ccFleetTruckRemind = (org) => rpc("cc_fleet_truck_remind", { p_org: org });
      ccFleetTruckReminderStatus = (org) => rpc("cc_fleet_truck_reminder_status", { p_org: org });
      carrierFactoringPacket = (trip) => rpc("carrier_factoring_packet", { p_trip: trip });
      carrierFactoringBrokers = () => rpc("carrier_factoring_brokers");
      carrierFactoringBrokerSet = (broker, direct) => rpc("carrier_factoring_broker_set", { p_broker: broker, p_direct: direct });
      payTripMarkSent = (trip, receiptPath, receiptName, paymentRef) => rpc("pay_trip_mark_sent", { p_trip: trip, p_receipt_path: receiptPath, p_receipt_name: receiptName, p_payment_ref: paymentRef ?? null, p_method: "bank_transfer" });
      payRequestReminder = (kind, ref) => rpc("pay_request_reminder", { p_kind: kind, p_ref: ref });
      carrierEldSetup = (provider, rotate, apiToken, orgName) => rpc("carrier_eld_setup", { p_provider: provider ?? "generic", p_rotate: !!rotate, p_api_token: apiToken ?? null, p_org_name: orgName ?? null });
      carrierEldStatus = () => rpc("carrier_eld_status", {});
      carrierEldDisconnect = (provider) => rpc("carrier_eld_disconnect", { p_provider: provider });
      carrierAccountingExport = (from, to) => rpc("carrier_accounting_export", { p_from: from ?? null, p_to: to ?? null });
      carrierFuelImport = (rows) => rpc("carrier_fuel_import", { p_rows: rows });
      carrierAssignSuggestions = () => rpc("carrier_assignment_suggestions", {});
      carrierFleetPlan = () => rpc("carrier_fleet_plan", {});
      carrierFleetOptimization = (days) => rpc("carrier_fleet_optimization", { p_days: days ?? 90 });
      qboAuthUrl = (redirect) => rpc("qbo_auth_url", { p_redirect: redirect ?? null });
      qboStatus = () => rpc("qbo_status");
      trustProfile = (org) => rpc("cc_trust_profile", { p_org: org });
      myTrustProfile = () => rpc("cc_my_trust_profile");
      myHazmatReadiness = () => rpc("cc_my_hazmat_readiness");
      myApprovedPartners = () => rpc("cc_my_approved_partners");
      marketingIntel = (days = 30) => rpc("cc_marketing_intel", { p_days: days });
      rateStandards = () => rpc("cc_rate_standards");
      setRateStandard = (k, v) => rpc("cc_set_rate_standard", { p_key: k, p_value: v });
      rateStandardsList = () => rpc("cc_rate_standards");
      ccCarrierBackoffice = (id, quarter) => rpc("cc_carrier_backoffice", { p_carrier: id, p_quarter: quarter ?? null });
      referralPayoutDecide = (id, action, note) => rpc("cc_referral_payout_decide", { p_id: id, p_action: action, p_note: note ?? null });
      biExecutiveSummary = (from, to) => rpc("cc_bi_executive_summary", { p_from: from ?? null, p_to: to ?? null });
      biTimeseries = (metric, days = 30) => rpc("cc_bi_timeseries", { p_metric: metric, p_days: days });
      reportsList = () => rpc("cc_reports");
      reportSave = (def) => rpc("cc_report_save", { p: def });
      reportDelete = (id) => rpc("cc_report_delete", { p_id: id });
      reportRun = (id) => rpc("cc_report_run", { p_id: id });
      reportSnapshots = (id, limit = 20) => rpc("cc_report_snapshots", { p_id: id, p_limit: limit });
      carrierScorecard = (carrier, days = 90) => rpc("cc_carrier_scorecard", { p_carrier: carrier ?? null, p_days: days });
      carrierScorecardRanking = (days = 90, limit = 25) => rpc("cc_carrier_scorecard_ranking", { p_days: days, p_limit: limit });
      brokerSla = (partner, days = 90) => rpc("cc_broker_sla", { p_partner: partner ?? null, p_days: days });
      brokerSlaRanking = (days = 90, limit = 25) => rpc("cc_broker_sla_ranking", { p_days: days, p_limit: limit });
      myNotifications = (limit = 50) => rpc("cc_my_notifications", { p_limit: limit });
      markMyNotification = (id) => rpc("cc_mark_my_notification", { p_id: id });
      notifyBroadcast = (payload) => rpc("cc_notify_broadcast", { p: payload });
      reportSetSchedule = (id, schedule) => rpc("cc_report_set_schedule", { p_id: id, p_schedule: schedule });
      carrierDashboard = () => rpc("cc_carrier_dashboard");
      carrierLoadDetail = (loadId) => rpc("cc_load_detail", { p_load: loadId });
      tripEmergencyRequest = (payload) => rpc("cc_trip_emergency_request", { p: payload });
      tripMyEmergencies = (limit = 50) => rpc("cc_trip_my_emergencies", { p_limit: limit });
      emergencyReview = (id, approve, note) => rpc("cc_emergency_review", { p_id: id, p_approve: approve, p_note: note ?? null });
      emergencyQueue = (status = "open", limit = 100) => rpc("cc_emergency_queue", { p_status: status, p_limit: limit });
      fleetServiceAdd = (payload) => rpc("cc_fleet_service_add", { p: payload });
      fleetServiceList = (truckId = null, limit = 100) => rpc("cc_fleet_service_list", { p_truck: truckId, p_limit: limit });
      fleetServiceDelete = (id) => rpc("cc_fleet_service_delete", { p_id: id });
      payrollAdd = (payload) => rpc("cc_payroll_add", { p: payload });
      payrollList = (from = null, to = null) => rpc("cc_payroll_list", { p_from: from, p_to: to });
      payrollMarkPaid = (id, paid = true) => rpc("cc_payroll_mark_paid", { p_id: id, p_paid: paid });
      payrollDelete = (id) => rpc("cc_payroll_delete", { p_id: id });
      workflowSave = (o) => rpc("cc_workflow_save", { p: o });
      workflowSetStatus = (id, action) => rpc("cc_workflow_set_status", { p_id: id, p_action: action });
      workflowsList = (status) => rpc("cc_workflows", { p_status: status ?? null });
      workflowRun = (id, event, mode) => rpc("cc_workflow_run", { p_id: id, p_event: event ?? {}, p_mode: mode ?? "simulation" });
      workflowRuns = (id, limit) => rpc("cc_workflow_runs", { p_id: id, p_limit: limit ?? 30 });
      financeReceivables = () => rpc("cc_finance_receivables");
      financePayables = () => rpc("cc_finance_payables");
      invoicePrepQueue = (limit) => rpc("cc_invoice_prep_queue", { p_limit: limit ?? 50 });
      financeReconcile = (from, to) => rpc("cc_finance_reconcile", { p_from: from ?? null, p_to: to ?? null });
      carrierPnl = (from, to, carrierId) => rpc("cc_carrier_pnl", { p_from: from ?? null, p_to: to ?? null, p_carrier: carrierId ?? null });
      carrierAddExpense = (o) => rpc("cc_carrier_add_expense", { p: o });
      carrierExpenses = (from, to, limit) => rpc("cc_carrier_expenses", { p_from: from ?? null, p_to: to ?? null, p_limit: limit ?? 200 });
      carrierDeleteExpense = (id) => rpc("cc_carrier_delete_expense", { p_id: id });
      partnerChecklistSubmit = (itemId, ref, note) => rpc("cc_partner_checklist_submit", { p_item: itemId, p_ref: ref, p_note: note ?? null });
      loadChecklistReview = (itemId, verdict, reason) => rpc("cc_load_checklist_review", { p_item: itemId, p_verdict: verdict, p_reason: reason ?? null });
      requestUpdate = (subjectType, subjectId, partnerOrg, request, due) => rpc("cc_request_update", { p_subject_type: subjectType, p_subject_id: subjectId, p_partner: partnerOrg, p_request: request, p_due: due ?? null });
      updateRequests = (status, limit) => rpc("cc_update_requests", { p_status: status ?? "open", p_limit: limit ?? 100 });
      partnerUpdateRequests = (status) => rpc("cc_partner_update_requests", { p_status: status ?? null });
      partnerRespondUpdate = (id, response) => rpc("cc_partner_respond_update", { p_id: id, p_response: response });
      resolveUpdateRequest = (id, action) => rpc("cc_resolve_update_request", { p_id: id, p_action: action ?? "resolve" });
      tripArrive = (tripId, stop, freeMinutes) => rpc("cc_trip_arrive", { p_trip: tripId, p_stop: stop, p_free_minutes: freeMinutes ?? 120 });
      tripArriveGps = (tripId, stop, lat, lng, freeMinutes) => rpc("cc_trip_arrive_gps", { p_trip: tripId, p_stop: stop, p_lat: lat ?? null, p_lng: lng ?? null, p_free_minutes: freeMinutes ?? 120 });
      tripSetStopCoords = (tripId, plat, plng, dlat, dlng) => rpc("cc_trip_set_stop_coords", { p_trip: tripId, p_plat: plat ?? null, p_plng: plng ?? null, p_dlat: dlat ?? null, p_dlng: dlng ?? null });
      carrierRequestAccessorial = (trip, kind, note, amount) => rpc("cc_carrier_request_accessorial", { p_trip: trip, p_kind: kind, p_note: note ?? null, p_amount: amount ?? null });
      tripAccessorials = (tripId) => rpc("cc_trip_accessorials", { p_trip: tripId });
      pocketCancelTrip = (trip, reason) => rpc("cc_pocket_cancel_trip", { p_trip: trip, p_reason: reason });
      cancelPreview = (trip) => rpc("cc_cancel_preview", { p_trip: trip });
      tripPickupStatus = (trip) => rpc("cc_trip_pickup_status", { p_trip: trip });
      myCancellationRate = () => rpc("cc_my_cancellation_rate");
      partnerEligibleCarriers = (load) => rpc("cc_partner_eligible_carriers", { p_load: load });
      partnerOfferSend = (load, carriers, rate, expiryMinutes) => rpc("cc_partner_offer_send", { p_load: load, p_carriers: carriers, p_rate: rate ?? null, p_expiry_minutes: expiryMinutes ?? 15 });
      partnerCancelLoad = (load, reason, repost = true) => rpc("cc_partner_cancel_load", { p_load: load, p_reason: reason, p_repost: repost });
      partnerLoadCancellations = (load) => rpc("cc_partner_load_cancellations", { p_load: load });
      partnerCancellations = (limit) => rpc("cc_partner_cancellations", { p_limit: limit ?? 50 });
      pocketUploadTripDoc = (o = {}) => rpc("cc_pocket_upload_trip_doc", { p_trip: o.trip, p_kind: o.kind, p_path: o.path, p_file_name: o.fileName ?? "proof", p_content_type: o.contentType ?? null, p_size: o.size ?? null });
      claimBundle = (id) => rpc("cc_claim_bundle", { p_id: id });
      partnerClaims = () => rpc("cc_partner_claims", {});
      partnerReviewClaim = (id, action, note) => rpc("cc_partner_review_claim", { p_id: id, p_action: action, p_note: note ?? null });
      claimEscalate = (id) => rpc("cc_claim_escalate", { p_id: id });
      supportDecideClaim = (id, verdict, amount, note) => rpc("cc_support_decide_claim", { p_id: id, p_verdict: verdict, p_amount: amount ?? null, p_note: note ?? null });
      payInstructions = (kind, ref) => rpc("pay_instructions", { p_kind: kind, p_ref: ref });
      payMarkSent = (o = {}) => rpc("pay_mark_sent", { p_kind: o.kind, p_ref: o.ref, p_receipt_path: o.receiptPath, p_receipt_name: o.receiptName ?? "receipt", p_payment_ref: o.paymentRef ?? null, p_method: o.method ?? null });
      payConfirmReceived = (id) => rpc("pay_confirm_received", { p_id: id });
      payMyTransfers = () => rpc("pay_my_transfers", {});
      ccPayPendingFees = () => rpc("cc_pay_pending_fees", {});
      payDueItems = () => rpc("pay_due_items", {});
      payDispute = (kind, ref, note) => rpc("pay_dispute", { p_kind: kind, p_ref: ref, p_note: note ?? null });
      ccLoadStops = (load) => rpc("cc_load_stops", { p_load: load });
      tripStopsProgress = (trip) => rpc("cc_trip_stops_progress", { p_trip: trip });
      agentCarrierDirectory = () => rpc("cc_agent_carrier_directory");
      agentChainStatus = () => rpc("agent_chain_status", {});
      agentFeed = () => rpc("agent_feed", {});
      agentOnboardingStatus = () => rpc("agent_onboarding_status", {});
      agentSaveOnboarding = (p, submit) => rpc("agent_save_onboarding", { p, p_submit: !!submit });
      ccAgentsQueue = () => rpc("cc_agents_queue", {});
      ccAgentDecide = (user, action, note) => rpc("cc_agent_decide", { p_user: user, p_action: action, p_note: note ?? null });
      isMyOrgAgent = () => rpc("is_my_org_agent", {});
      agentPayoutCenter = () => rpc("agent_payout_center", {});
      agentRequestPayout = () => rpc("agent_request_payout", {});
      agentConfirmPayoutReceived = (id) => rpc("agent_confirm_payout_received", { p_id: id });
      agentSendInvite = (side, email, name) => rpc("agent_send_invite", { p_side: side, p_email: email, p_name: name ?? null });
      agentMsgSend = (body) => rpc("agent_msg_send", { p_body: body });
      agentMsgList = () => rpc("agent_msg_list", {});
      ccAgentMsgs = (user) => rpc("cc_agent_msgs", { p_user: user });
      ccAgentMsgSend = (user, body) => rpc("cc_agent_msg_send", { p_user: user, p_body: body });
      agentClaimUpline = (code) => rpc("agent_claim_upline", { p_code: code });
      ccAgentsList = () => rpc("cc_agents_list", {});
      ccAgent360 = (user) => rpc("cc_agent_360", { p_user: user });
      ccAgentNotifySend = (user, title, body, email) => rpc("cc_agent_notify_send", { p_user: user, p_title: title, p_body: body, p_email: !!email });
      ccAgentDocReview = (user, doc, action, reason) => rpc("cc_agent_doc_review", { p_user: user, p_doc: doc, p_action: action, p_reason: reason ?? null });
      partnerPacketRemind = (org, key) => rpc("cc_partner_packet_remind", { p_org: org, p_key: key });
      prefsProfileStrength = () => rpc("cc_prefs_profile_strength");
      prefsSaveSection = (section, payload) => rpc("cc_prefs_save_section", { p_section: section, p: payload ?? {} });
      requestAccountDeletion = (reason) => rpc("request_account_deletion", { p_reason: reason ?? null });
      cancelAccountDeletion = () => rpc("cancel_account_deletion");
      myAccountDeletionStatus = () => rpc("my_account_deletion_status");
      ccAccountDeletionQueue = () => rpc("cc_account_deletion_queue");
      ccAccountDeletionProcess = async (id, action, note) => {
        const result = await rpc("cc_account_deletion_process", { p_id: id, p_action: action, p_note: note ?? null });
        const expectedStatus = action === "reject" ? "rejected" : "completed";
        if (!result || result.ok !== true || result.error || result.status !== expectedStatus) {
          const error = new Error(result?.error || "Account deletion was not completed.");
          error.code = result?.code || "ACCOUNT_DELETION_INCOMPLETE";
          throw error;
        }
        return result;
      };
      ccAgentPayoutVerify = (user, ok, note) => rpc("cc_agent_payout_verify", { p_user: user, p_ok: ok, p_reason: note ?? null });
      ccAgentPayoutRequestDetails = (user, fields, note) => rpc("cc_agent_payout_request_details", { p_user: user, p_fields: fields, p_note: note ?? null });
      ccAgentPayoutApproveMethod = (user, note) => rpc("cc_agent_payout_approve_method", { p_user: user, p_note: note ?? null });
      dispatcherApply = (p, submit) => rpc("dispatcher_apply", { p, p_submit: !!submit });
      dispatcherSubmitId = (path, name) => rpc("dispatcher_submit_id", { p_path: path, p_name: name || null });
      dispatcherTestMy = () => rpc("dispatcher_test_my", {});
      dispatcherTestStart = () => rpc("dispatcher_test_start", {});
      dispatcherTestSave = (q, answer, seconds, paste) => rpc("dispatcher_test_save", { p_question: q, p_answer: answer, p_seconds: seconds || 0, p_paste: paste || 0 });
      dispatcherTestSubmit = (integrity) => rpc("dispatcher_test_submit", { p_integrity: integrity || {} });
      ccDispatcherTestInvite = (user, minutes, startHours) => rpc("cc_dispatcher_test_invite", { p_user: user, p_minutes: minutes || 45, p_start_hours: startHours || 48 });
      ccDispatcherTestReview = (user) => rpc("cc_dispatcher_test_review", { p_user: user });
      ccDispatcherTestScore = (attempt, scores, decision, note) => rpc("cc_dispatcher_test_score", { p_attempt: attempt, p_scores: scores || {}, p_decision: decision || null, p_note: note || null });
      ccDispatcherTestSendScore = (attempt) => rpc("cc_dispatcher_test_send_score", { p_attempt: attempt });
      dispatcherMyStatus = () => rpc("dispatcher_my_status", {});
      dispatcherReapply = (check) => rpc("dispatcher_reapply", { p_check: !!check });
      ccDispatchersList = () => rpc("cc_dispatchers_list", {});
      ccDispatchersPage = (o = {}) => rpc("cc_dispatchers_page", { p_q: o.q || null, p_status: o.status || null, p_before: o.before || null, p_before_id: o.beforeId || null, p_limit: o.limit || 50, p_user: o.user || null });
      ccDispatchersStats = () => rpc("cc_dispatchers_stats", {});
      ccDispatchersBoard = (perStage) => rpc("cc_dispatchers_board", { p_per_stage: perStage || 14 });
      ccDispatcherPayouts = (status, limit) => rpc("cc_dispatcher_payouts", { p_status: status ?? null, p_limit: limit || 200 });
      ccDispatcherActivity = (user, limit) => rpc("cc_dispatcher_activity", { p_user: user, p_limit: limit || 40 });
      ccDispatcher360 = (user) => rpc("cc_dispatcher_360", { p_user: user });
      ccDispatcherDecide = (user, action, note) => rpc("cc_dispatcher_decide", { p_user: user, p_action: action, p_note: note ?? null });
      ccDispatcherAssign = (dispatcher, carrierOrg, sop) => rpc("cc_dispatcher_assign", { p_dispatcher: dispatcher, p_carrier_org: carrierOrg, p_sop: sop ?? {} });
      ccDispatcherSop = (assignment, sop) => rpc("cc_dispatcher_sop", { p_assignment: assignment, p_sop: sop ?? {} });
      ccDispatcherUnassign = (assignment, reason, pause) => rpc("cc_dispatcher_unassign", { p_assignment: assignment, p_reason: reason ?? null, p_pause: !!pause });
      ccDispatcherSalarySet = (user, base, perTruck, currency) => rpc("cc_dispatcher_salary_set", { p_user: user, p_base: base, p_per_truck: perTruck, p_currency: currency ?? "PKR" });
      ccDispatcherSalaryRun = (user, period, bonus, kpi, note) => rpc("cc_dispatcher_salary_run", { p_user: user, p_period: period, p_bonus: bonus ?? 0, p_kpi: kpi ?? {}, p_note: note ?? null });
      ccDispatcherSalaryStatus = (id, status) => rpc("cc_dispatcher_salary_status", { p_id: id, p_status: status });
      ccCarrierPrefs = (carrier) => rpc("cc_carrier_prefs", { p_carrier: carrier });
      dispatcherWorkspaceFeed = () => rpc("dispatcher_workspace_feed", {});
      dispatcherSetAvailability = (truck, p) => rpc("dispatcher_set_availability", { p_truck: truck, p: p ?? {} });
      dispatcherLogBooking = (p) => rpc("dispatcher_log_booking", { p: p ?? {} });
      dispatcherBookingUpdate = (id, p) => rpc("dispatcher_booking_update", { p_id: id, p: p ?? {} });
      dispatcherBookingEvent = (booking, kind, note, location2, eta) => rpc("dispatcher_booking_event", { p_booking: booking, p_kind: kind, p_note: note ?? null, p_location: location2 ?? null, p_eta: eta ?? null });
      dispatcherBookingTimeline = (booking) => rpc("dispatcher_booking_timeline", { p_booking: booking });
      dispatcherBrokerUpsert = (p) => rpc("dispatcher_broker_upsert", { p: p ?? {} });
      dispatcherBrokerDelete = (id) => rpc("dispatcher_broker_delete", { p_id: id });
      dispatcherThreadList = (assignment, limit) => rpc("dispatcher_thread_list", { p_assignment: assignment, p_limit: limit ?? 200 });
      dispatcherThreadSend = (assignment, body) => rpc("dispatcher_thread_send", { p_assignment: assignment, p_body: body });
      carrierMyDispatcher = () => rpc("carrier_my_dispatcher", {});
      ccDispatcherSetTerms = (user, pct, trialStart, trialEnd) => rpc("cc_dispatcher_set_terms", { p_user: user, p_commission_pct: pct, p_trial_start: trialStart ?? null, p_trial_end: trialEnd ?? null });
      ccDispatcherBookings = (o = {}) => rpc("cc_dispatcher_bookings", { p_user: o.user ?? null, p_status: o.status ?? null, p_limit: o.limit ?? 200 });
      ccDispatcherBookingDecide = (id, action, note) => rpc("cc_dispatcher_booking_decide", { p_id: id, p_action: action, p_note: note ?? null });
      ccDispatcherCommissionStatus = (id, status, note) => rpc("cc_dispatcher_commission_status", { p_id: id, p_status: status, p_note: note ?? null });
      ccDispatcherCommissionList = (user) => rpc("cc_dispatcher_commission_list", { p_user: user ?? null });
      dispatcherThreadMarkRead = (assignment) => rpc("dispatcher_thread_mark_read", { p_assignment: assignment });
      ccDispatcherQueue = () => rpc("cc_dispatcher_queue", {});
      ccDispatcherCommissionPay = (ids, p) => rpc("cc_dispatcher_commission_pay", { p_ids: ids, p: p ?? {} });
      carrierMyDispatcherBookings = (limit) => rpc("carrier_my_dispatcher_bookings", { p_limit: limit ?? 100 });
      carrierDispatcherAck = (assignment) => rpc("carrier_dispatcher_ack", { p_assignment: assignment });
      carrierDispatcherPause = (assignment, pause, reason) => rpc("carrier_dispatcher_pause", { p_assignment: assignment, p_pause: !!pause, p_reason: reason ?? null });
      ccDispatcherResendIntro = (assignment) => rpc("cc_dispatcher_resend_intro", { p_assignment: assignment });
      carrierBookingAck = (booking, ok, note) => rpc("carrier_booking_ack", { p_booking: booking, p_ok: !!ok, p_note: note ?? null });
      dispatcherBoard = (org, limit) => rpc("dispatcher_board", { p_org: org, p_limit: limit ?? 20 });
      dispatcherLoadDetail = (org, load) => rpc("dispatcher_load_detail", { p_org: org, p_load: load });
      dispatcherRequestBook = (org, load, note) => rpc("dispatcher_request_book", { p_org: org, p_load: load, p_note: note ?? null });
      dispatcherPostTruck = (org, p) => rpc("dispatcher_post_truck", { p_org: org, p: p ?? {} });
      dispatcherUpdatePosting = (org, id, action) => rpc("dispatcher_update_posting", { p_org: org, p_id: id, p_action: action });
      dispatcherPostingMatches = (org, id) => rpc("dispatcher_posting_matches", { p_org: org, p_id: id });
      dispatcherMyKpis = (days) => rpc("dispatcher_my_kpis", { p_days: days ?? 30 });
      ccDispatcherKpis = (user, days) => rpc("cc_dispatcher_kpis", { p_user: user, p_days: days ?? 30 });
      dispatcherTrip = (org, trip) => rpc("dispatcher_trip", { p_org: org, p_trip: trip });
      dispatcherTripAction = (org, trip, action, p) => rpc("dispatcher_trip_action", { p_org: org, p_trip: trip, p_action: action, p: p ?? {} });
      partnerUpdateLoad = (load, p) => rpc("partner_update_load", { p_load: load, p });
      partnerLoadChangeRequest = (load, request) => rpc("partner_load_change_request", { p_load: load, p_request: request });
      ccOutreachStats = (days) => rpc("cc_outreach_stats", { p_days: days ?? 30 });
      ccOutreachCrm = (days) => rpc("cc_outreach_crm", { p_days: days ?? 30 });
      ccOutreachControl = (action, value) => rpc("cc_outreach_control", { p_action: action, p_value: value ?? null });
      ccOutreachToday = () => rpc("cc_outreach_today", {});
      ccOutreachTemplates = () => rpc("cc_outreach_templates", {});
      ccOutreachTemplatePreview = (id) => rpc("cc_outreach_template_preview", { p_id: id });
      ccOutreachTemplateSave = (o) => rpc("cc_outreach_template_save", { p_audience: o.audience, p_day: o.day, p_subject: o.subject, p_html: o.html ?? null, p_active: o.active ?? true });
      ccOutreachLog = (filter, limit) => rpc("cc_outreach_log", { p_filter: filter || "all", p_limit: limit ?? 100 });
      ccOutreachLogPage = (o) => rpc("cc_outreach_log_page", {
        p_filter: o && o.filter || "all",
        p_kind: o && o.kind || null,
        p_days: (o && o.days) ?? 30,
        p_q: o && o.q || null,
        p_limit: (o && o.limit) ?? 50,
        p_offset: (o && o.offset) ?? 0
      });
      ccOutreachAudience = (days) => rpc("cc_outreach_audience", { p_days: days ?? 30 });
      ccLcList = (status, search) => rpc("cc_lc_list", { p_status: status || "open", p_search: search ?? null });
      ccLcGet = (id) => rpc("cc_lc_get", { p_id: id });
      ccLcReply = (id, body) => rpc("cc_lc_reply", { p_id: id, p_body: body });
      ccLcSetStatus = (id, status) => rpc("cc_lc_set_status", { p_id: id, p_status: status });
      ccLcStats = () => rpc("cc_lc_stats", {});
      ccLcMisses = () => rpc("cc_lc_misses", {});
      ccLcTeach = (missId, patterns, answer) => rpc("cc_lc_teach", { p_miss_id: missId ?? null, p_patterns: patterns, p_answer: answer });
      ccLcMissDismiss = (missId) => rpc("cc_lc_miss_dismiss", { p_miss_id: missId });
      ccLcAssign = (id, take) => rpc("cc_lc_assign", { p_id: id, p_take: take !== false });
      ccLcCannedList = () => rpc("cc_lc_canned_list", {});
      ccLcCannedSave = (title, body) => rpc("cc_lc_canned_save", { p_title: title, p_body: body });
      ccLcCannedDelete = (id) => rpc("cc_lc_canned_delete", { p_id: id });
      ccRetellCallback = (o) => rpc("cc_retell_callback", { p_to: o.to, p_name: o.name ?? null, p_topic: o.topic ?? null, p_role: o.role ?? null, p_context: o.context ?? null, p_when: o.when ?? null });
      ccLcCalls = () => rpc("cc_lc_calls", {});
      ccLcPresenceGet = () => rpc("cc_lc_presence_get", {});
      ccLcPresenceSet = (available, name, designation, alertEmail) => rpc("cc_lc_presence_set", { p_available: available, p_name: name ?? null, p_designation: designation ?? null, p_alert_email: alertEmail ?? null });
      ccLcHeartbeat = () => rpc("cc_lc_heartbeat", {});
      ccLcTyping = (id) => rpc("cc_lc_typing", { p_id: id });
      ccLcBotResume = (id) => rpc("cc_lc_bot_resume", { p_id: id });
      reviewAccessorial = (id, action, amount, note) => rpc("cc_review_accessorial", { p_id: id, p_action: action, p_amount: amount ?? null, p_note: note ?? null });
      accessorialQueue = (limit) => rpc("cc_accessorial_queue", { p_limit: limit ?? 100 });
      tripDepart = (tripId, stop, lat, lng) => rpc("cc_trip_depart", { p_trip: tripId, p_stop: stop, p_lat: lat ?? null, p_lng: lng ?? null });
      detentionScan = (ratePerHour) => rpc("cc_detention_scan", { p_rate_per_hour: ratePerHour ?? 50 });
      exceptionCenter = (status, limit) => rpc("cc_exception_center", { p_status: status ?? "open", p_limit: limit ?? 100 });
      reviewDocument = (documentId, decision, note) => rpc("admin_review_document", { p_document: documentId, p_decision: decision, p_note: note ?? null });
      coiPanel = (documentId) => rpc("cc_coi_panel", { p_document: documentId });
      staffUploadDocument = (o = {}) => rpc("cc_staff_upload_document", {
        p_carrier: o.carrier,
        p_type: o.type,
        p_path: o.path,
        p_file_name: o.fileName,
        p_source: o.source ?? "email",
        p_source_note: o.sourceNote ?? null
      });
      documentProvenance = (documentId) => rpc("cc_document_provenance", { p_document: documentId });
      requestAccountAction = (action, reason) => rpc("cc_request_account_action", { p_action: action, p_reason: reason ?? null });
      accountRequests = (status, limit) => rpc("cc_account_requests", { p_status: status ?? "open", p_limit: limit ?? 100 });
      resolveAccountRequest = (id, status, note) => rpc("cc_resolve_account_request", { p_id: id, p_status: status, p_note: note ?? null });
      setCoiCoverage = (o = {}) => rpc("cc_set_coi_coverage", {
        p_org: o.org,
        p_mode: o.mode,
        p_vins: o.vins ?? null,
        p_document: o.document ?? null,
        p_expiry: o.expiry ?? null,
        p_note: o.note ?? null
      });
      assignRole = (o) => rpc("admin_assign_role", {
        p_user: o.userId,
        p_role_key: o.roleKey,
        p_scope_type: o.scopeType,
        p_org: o.org ?? null,
        p_carrier_org: o.carrierOrg ?? null,
        p_load: o.load ?? null
      });
      revokeRole = (assignmentId) => rpc("admin_revoke_role", { p_assignment: assignmentId });
      setStaffStatus = (userId, status) => rpc("admin_set_staff_status", { p_user: userId, p_status: status });
      revokeStaffSessions = (userId) => rpc("admin_revoke_staff_sessions", { p_user: userId });
      assignLoad = (loadId, carrierId) => rpc("cc_assign_load", { p_load: loadId, p_carrier: carrierId });
      setLoadStatus = (loadId, status) => rpc("cc_set_load_status", { p_load: loadId, p_status: status });
      listTasks = (o = {}) => rpc("cc_list_tasks", { p_status: o.status ?? "open", p_limit: o.limit ?? 100 });
      completeTask = (taskId) => rpc("cc_complete_task", { p_task: taskId });
      startTask = (taskId) => rpc("cc_task_start", { p_task: taskId });
      invoiceVoid = (id, reason) => rpc("cc_invoice_void", { p_invoice: id, p_reason: reason });
      invoiceCredit = (id, amount, reason) => rpc("cc_invoice_credit", { p_invoice: id, p_amount: amount, p_reason: reason });
      tripRevert = (id, toStatus, reason) => rpc("cc_trip_revert", { p_trip: id, p_to_status: toStatus, p_reason: reason });
      agentSuspend = (userId, suspend, reason) => rpc("cc_agent_suspend", { p_user: userId, p_suspend: suspend, p_reason: reason });
      invoiceSendReminder = (id, note) => rpc("cc_invoice_send_reminder", { p_invoice: id, p_note: note ?? null });
      invoiceLookup = (no) => rpc("cc_invoice_lookup", { p_no: no });
      feeInvoiceQueue = () => rpc("cc_fee_invoice_queue");
      feeInvoiceApprove = (id, note) => rpc("cc_fee_invoice_approve", { p_invoice: id, p_note: note ?? null });
      feeInvoiceReject = (id, reason) => rpc("cc_fee_invoice_reject", { p_invoice: id, p_reason: reason });
      payAutopayStatus = () => rpc("pay_autopay_status");
      payAutopayDisable = () => rpc("pay_autopay_disable");
      tripNotifyParties = (tripId, target, note) => rpc("cc_trip_notify_parties", { p_trip: tripId, p_target: target ?? "both", p_note: note ?? null });
      automationHealth = () => rpc("cc_automation_health");
      crmOverview = () => rpc("cc_crm_overview");
      crmListLeads = (o = {}) => rpc("cc_crm_list_leads", { p_stage: o.stage ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      crmGetLead = (id) => rpc("cc_crm_get_lead", { p_lead: id });
      crmCreateLead = (o = {}) => rpc("cc_crm_create_lead", { p_title: o.title, p_company: o.company ?? null, p_source: o.source ?? null, p_value: o.value ?? null });
      crmSetLeadStage = (id, stageKey) => rpc("cc_crm_set_lead_stage", { p_lead: id, p_stage_key: stageKey });
      crmAddActivity = (id, kind, body) => rpc("cc_crm_add_activity", { p_lead: id, p_kind: kind, p_body: body, p_due_at: null });
      complianceOverview = () => rpc("cc_compliance_overview");
      listOnboarding = (o = {}) => rpc("cc_list_onboarding", { p_stage: o.stage ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      getCarrierCompliance = (carrierId) => rpc("cc_get_carrier_compliance", { p_carrier: carrierId });
      startOnboarding = (carrierId) => rpc("cc_start_onboarding", { p_carrier: carrierId });
      setCompliance = (o = {}) => rpc("cc_set_compliance", { p_carrier: o.carrier, p_requirement_key: o.requirement, p_status: o.status, p_expiry: o.expiry ?? null, p_note: o.note ?? null });
      decideOnboarding = (carrierId, decision, note) => rpc("cc_decide_onboarding", { p_carrier: carrierId, p_decision: decision, p_note: note ?? null });
      scanExpiring = (days) => rpc("cc_scan_expiring", { p_days: days ?? 30 });
      dispatchOverview = () => rpc("cc_dispatch_overview");
      listTrips = (o = {}) => rpc("cc_list_trips", { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      getTrip = (tripId) => rpc("cc_get_trip", { p_trip: tripId });
      createTrip = (o = {}) => rpc("cc_create_trip", {
        p_load: o.load,
        p_carrier: o.carrier ?? null,
        p_driver_name: o.driverName ?? null,
        p_driver_phone: o.driverPhone ?? null,
        p_truck: o.truck ?? null,
        p_scheduled_pickup: o.scheduledPickup ?? null,
        p_scheduled_delivery: o.scheduledDelivery ?? null
      });
      advanceTrip = (tripId, status, note, location2) => rpc("cc_advance_trip", { p_trip: tripId, p_status: status, p_note: note ?? null, p_location: location2 ?? null });
      addTripNote = (tripId, note, location2) => rpc("cc_add_trip_note", { p_trip: tripId, p_note: note, p_location: location2 ?? null });
      mailStats = () => rpc("cc_mail_stats");
      mailList = (o = {}) => rpc("cc_mail_list", {
        p_limit: o.limit ?? 50,
        p_mailbox: o.mailbox ?? null,
        p_search: o.search ?? null,
        p_before: o.before ?? null
      });
      mailThread = (thread, markRead = true) => rpc("cc_mail_thread", { p_thread: thread, p_mark_read: markRead !== false });
      mailMark = (thread, read = true) => rpc("cc_mail_mark", { p_thread: thread, p_read: read !== false });
      mailDraftSave = (thread, bodyHtml) => rpc("cc_mail_draft_save", { p_thread: thread, p_body_html: bodyHtml });
      mailDraftDiscard = (thread) => rpc("cc_mail_draft_discard", { p_thread: thread });
      mailSend = (draftId) => rpc("cc_mail_send", { p_draft_id: draftId });
      commOverview = () => rpc("cc_comm_overview");
      listThreads = (o = {}) => rpc("cc_list_threads", { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      getThread = (id) => rpc("cc_get_thread", { p_thread: id });
      createThread = (o = {}) => rpc("cc_create_thread", { p_subject: o.subject, p_body: o.body ?? null, p_related_type: o.relatedType ?? "none", p_related_id: o.relatedId ?? null, p_channel: o.channel ?? "in_app" });
      postMessage = (id, body, channel) => rpc("cc_post_message", { p_thread: id, p_body: body, p_channel: channel ?? null });
      setThreadStatus = (id, status) => rpc("cc_set_thread_status", { p_thread: id, p_status: status });
      listNotifications = (o = {}) => rpc("cc_list_notifications", { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
      markNotification = (id, status) => rpc("cc_mark_notification", { p_id: id, p_status: status });
      listTemplates = () => rpc("cc_list_templates");
      financeOverview = () => rpc("cc_finance_overview");
      financeAnalytics = () => rpc("cc_finance_analytics");
      listModules = () => rpc("cc_list_modules");
      moduleSummary = () => rpc("cc_module_summary");
      systemHealth = () => rpc("cc_system_health");
      cmpList = () => rpc("cc_cmp_list");
      cmpSave = (o = {}) => rpc("cc_cmp_save", { p_id: o.id || null, p_name: o.name, p_objective: o.objective || null, p_audience: o.audienceId || null, p_template: o.templateKey || null, p_channels: o.channels ?? ["push"], p_subject: o.subject ?? null, p_body: o.body ?? null, p_scheduled_at: o.scheduledAt || null, p_status: o.status || "draft" });
      cmpSetStatus = (id, status) => rpc("cc_cmp_set_status", { p_id: id, p_status: status });
      cmpMarkSent = (id, count) => rpc("cc_cmp_mark_sent", { p_id: id, p_count: count });
      reminderTargets = () => rpc("cc_reminder_targets");
      reminderSend = (keys = null, dryRun = true, ignoreCadence = false) => rpc("cc_reminder_send", { p_keys: keys, p_dry_run: dryRun, p_ignore_cadence: ignoreCadence });
      reminderCarrier = (org) => rpc("cc_reminder_carrier", { p_org: org });
      reminderSendCarrier = (org, ignoreCadence = false) => rpc("cc_reminder_send_carrier", { p_org: org, p_ignore_cadence: ignoreCadence });
      formProgressPing = (form, fields = 0) => rpc("cc_form_progress_ping", { p_form: form, p_fields: fields });
      formProgressDone = (form) => rpc("cc_form_progress_done", { p_form: form });
      campaignAudiencePreview = (campaignId) => rpc("cc_campaign_audience_preview", { p_campaign: campaignId });
      campaignEnqueue = (campaignId, confirmCount) => rpc("cc_campaign_enqueue", { p_campaign: campaignId, p_confirm_count: confirmCount });
      campaignApprove = (campaignId, approve = true) => rpc("cc_campaign_approve", { p_campaign: campaignId, p_approve: approve });
      campaignVariants = (campaignId) => rpc("cc_campaign_variants", { p_campaign: campaignId });
      campaignSetVariant = (campaignId, o = {}) => rpc("cc_campaign_set_variant", { p_campaign: campaignId, p_label: o.label, p_subject: o.subject ?? null, p_body_html: o.bodyHtml ?? null, p_body_text: o.bodyText ?? null, p_weight: o.weight ?? 1 });
      campaignDeleteVariant = (id) => rpc("cc_campaign_delete_variant", { p_id: id });
      campaignVariantAnalytics = (campaignId) => rpc("cc_campaign_variant_analytics", { p_campaign: campaignId });
      deliveryClaim = (o = {}) => rpc("cc_delivery_claim", { p_limit: o.limit ?? 50, p_channel: o.channel ?? "email" });
      deliveryMark = (id, status, o = {}) => rpc("cc_delivery_mark", { p_id: id, p_status: status, p_reason: o.reason ?? null, p_provider: o.provider ?? null, p_dedupe: o.dedupe ?? null });
      suppress = (channel, address, reason) => rpc("cc_suppress", { p_channel: channel, p_address: address, p_reason: reason ?? "manual" });
      deliveryHealth = () => rpc("cc_delivery_health");
      pipelineHealth = () => rpc("cc_pipeline_health");
      commTriggers = () => rpc("cc_comm_triggers");
      setCommTrigger = (o = {}) => rpc("cc_set_comm_trigger", { p_event: o.event, p_channel: o.channel ?? "email", p_template_key: o.templateKey ?? null, p_subject: o.subject ?? null, p_active: o.active ?? false });
      campaignAnalytics = (campaignId) => rpc("cc_campaign_analytics", { p_campaign: campaignId });
      campaignAttribution = (campaignId) => rpc("cc_campaign_attribution", { p_campaign: campaignId });
      enqueueTransactional = (o = {}) => rpc("cc_enqueue_transactional", { p_channel: o.channel ?? "email", p_email: o.email, p_template_key: o.templateKey ?? null, p_subject: o.subject ?? null, p_idem: o.idem ?? null, p_meta: o.meta ?? {}, p_scheduled_at: o.scheduledAt ?? null });
      deliveryReleaseDue = (channel) => rpc("cc_delivery_release_due", { p_channel: channel ?? null });
      deliveryList = (o = {}) => rpc("cc_delivery_list", { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
      suppressionsList = (o = {}) => rpc("cc_suppressions_list", { p_channel: o.channel ?? null, p_limit: o.limit ?? 200 });
      audienceEstimate = (type) => rpc("cc_audience_estimate", { p_type: type });
      listAudiences = () => rpc("cc_list_audiences");
      saveAudience = (o = {}) => rpc("cc_save_audience", { p_name: o.name, p_type: o.type, p_filters: o.filters ?? {} });
      deleteAudience = (id) => rpc("cc_delete_audience", { p_id: id });
      AUDIENCE_TYPES = [["all_carriers", "All carriers"], ["active_carriers", "Active carriers"], ["pending_carriers", "Pending carriers"], ["onboarding_pending", "Onboarding \u2014 awaiting review"], ["carrier_owners", "Carrier owners"], ["drivers", "Drivers"], ["leads", "Website leads"], ["newsletter", "Newsletter subscribers"], ["form_submitters", "Website form leads"], ["all_staff", "All staff"], ["manual_list", "Manual list \u2014 paste addresses"]];
      studioListTemplates = () => rpc("cc_studio_list_templates");
      studioSaveTemplate = (t = {}) => rpc("cc_studio_save_template", { p_key: t.key, p_name: t.name, p_category: t.category, p_channels: t.channels, p_subject: t.subject, p_preview: t.preview, p_body_html: t.bodyHtml, p_body_text: t.bodyText, p_status: t.status });
      studioSetTemplateStatus = (key, status) => rpc("cc_studio_set_template_status", { p_key: key, p_status: status });
      renderTemplate = (key, vars = {}) => rpc("cc_render_template", { p_key: key, p_vars: vars });
      TEMPLATE_VARIABLES = ["first_name", "company_name", "carrier_name", "load_reference", "pickup_city", "delivery_city", "appointment_time", "document_type", "document_expiry", "invoice_number", "settlement_number", "support_reference", "action_url"];
      listWebhookEndpoints = () => rpc("cc_list_webhook_endpoints");
      listWebhookDeliveries = (o = {}) => rpc("cc_list_webhook_deliveries", { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
      retryWebhookDelivery = (id) => rpc("cc_retry_webhook_delivery", { p_id: id });
      webhooksFlush = () => rpc("cc_webhooks_flush");
      eventCatalog = () => rpc("cc_event_catalog");
      listInvoices = (o = {}) => rpc("cc_list_invoices", { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      getInvoice = (id) => rpc("cc_get_invoice", { p_invoice: id });
      createInvoice = (tripId, dueDays) => rpc("cc_create_invoice", { p_trip: tripId, p_due_days: dueDays ?? 15 });
      setInvoiceStatus = (id, status) => rpc("cc_set_invoice_status", { p_invoice: id, p_status: status });
      listSettlements = (o = {}) => rpc("cc_list_settlements", { p_status: o.status ?? null, p_limit: o.limit ?? 200 });
      createSettlement = (o = {}) => rpc("cc_create_settlement", { p_carrier: o.carrier, p_period_start: o.periodStart ?? null, p_period_end: o.periodEnd ?? null });
      decideSettlement = (id, decision) => rpc("cc_decide_settlement", { p_settlement: id, p_decision: decision });
      analyticsOverview = () => rpc("cc_analytics_overview");
      analyticsRevenue = (days) => rpc("cc_analytics_revenue", { p_days: days ?? 14 });
      analyticsOps = () => rpc("cc_analytics_ops");
      analyticsCarriers = (limit) => rpc("cc_analytics_carriers", { p_limit: limit ?? 8 });
      contentOverview = () => rpc("cc_content_overview");
      listPosts = (o = {}) => rpc("cc_list_posts", { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      getPost = (id) => rpc("cc_get_post", { p_id: id });
      upsertPost = (o = {}) => rpc("cc_upsert_post", { p_id: o.id ?? null, p_title: o.title, p_slug: o.slug, p_excerpt: o.excerpt ?? null, p_body: o.body ?? null, p_tags: o.tags ?? [] });
      setPostStatus = (id, status) => rpc("cc_set_post_status", { p_id: id, p_status: status });
      listPages = () => rpc("cc_list_pages");
      upsertPage = (key, title, body) => rpc("cc_upsert_page", { p_key: key, p_title: title, p_body: body });
      integrationsOverview = () => rpc("cc_integrations_overview");
      listIntegrations = () => rpc("cc_list_integrations");
      listEndpoints = () => rpc("cc_list_endpoints");
      myWebhooks = () => rpc("my_webhooks");
      myWebhookCreate = (name, url, eventTypes) => rpc("my_webhook_create", { p_name: name, p_url: url, p_event_types: eventTypes ?? [] });
      myWebhookDelete = (id) => rpc("my_webhook_delete", { p_id: id });
      createEndpoint = (o = {}) => rpc("cc_create_endpoint", { p_name: o.name, p_url: o.url, p_event_types: o.eventTypes ?? [] });
      setEndpointActive = (id, active) => rpc("cc_set_endpoint_active", { p_id: id, p_active: active });
      testEndpoint = (id) => rpc("cc_test_endpoint", { p_id: id });
      listDeliveries = (o = {}) => rpc("cc_list_deliveries", { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
      pocketOverview = () => rpc("cc_pocket_overview");
      myCarrierOrg = () => rpc("cc_my_carrier_org");
      pocketTrips = (limit) => rpc("cc_pocket_trips", { p_limit: limit ?? 50 });
      pocketInvoices = (limit) => rpc("cc_pocket_invoices", { p_limit: limit ?? 50 });
      pocketCompliance = () => rpc("cc_pocket_compliance");
      carrierRequestReverify = (requirement, reason) => rpc("cc_carrier_request_reverify", { p_requirement: requirement, p_reason: reason ?? null });
      carrierSignAgreement = (name, date, ref) => rpc("cc_carrier_sign_agreement", { p_name: name, p_date: date ?? null, p_ref: ref ?? null });
      carrierAgreementSignature = (org) => rpc("cc_carrier_agreement_signature", { p_org: org ?? null });
      carrierSubmitW9 = (payload) => rpc("cc_carrier_submit_w9", { p: payload });
      carrierW9 = (org) => rpc("cc_carrier_w9", { p_org: org ?? null });
      pocketConfirmTrip = (tripId) => rpc("cc_pocket_confirm_trip", { p_trip: tripId });
      pocketRaiseIssue = (subject, body) => rpc("cc_pocket_raise_issue", { p_subject: subject, p_body: body ?? null });
      pocketMyIssues = (limit) => rpc("cc_pocket_my_issues", { p_limit: limit ?? 30 });
      publicLoadOpportunities = (limit) => rpc("get_public_load_opportunities", { p_limit: limit ?? 18 });
      pocketAvailableLoads = (limit) => rpc("cc_pocket_available_loads", { p_limit: limit ?? 24 });
      pocketBookLoad = (loadId) => rpc("cc_pocket_book_load", { p_load: loadId });
      requestBookLoad = (load, note) => rpc("cc_request_book_load", { p_load: load, p_note: note ?? null });
      tripPnl = (trip) => rpc("cc_trip_pnl", { p_trip: trip });
      tripFinanceAdd = (trip, direction, category, label, amount, note) => rpc("cc_trip_finance_add", { p_trip: trip, p_direction: direction, p_category: category ?? "other", p_label: label, p_amount: amount, p_note: note ?? null });
      tripFinanceRemove = (id) => rpc("cc_trip_finance_remove", { p_id: id });
      carrierEarnings = (from, to) => rpc("cc_carrier_earnings", { p_from: from ?? null, p_to: to ?? null });
      getCostModel = () => rpc("cc_get_cost_model");
      setCostModel = (o = {}) => rpc("cc_set_cost_model", { p_truck_mpg: o.truck_mpg ?? null, p_fuel_price: o.fuel_price ?? null, p_driver_pay_per_mile: o.driver_pay_per_mile ?? null, p_maint_per_mile: o.maint_per_mile ?? null, p_fixed_per_mile: o.fixed_per_mile ?? null, p_factoring_pct: o.factoring_pct ?? null });
      partnerUpdatePickup = (loadId, puDate, puTime, delDate, delTime, puMode, delMode, team) => rpc("cc_partner_update_pickup", { p_load: loadId, p_pickup_date: puDate, p_pickup_time: puTime ?? null, p_delivery_date: delDate ?? null, p_delivery_time: delTime ?? null, p_pickup_mode: puMode ?? null, p_delivery_mode: delMode ?? null, p_team: team ?? null });
      myBookRequests = (limit) => rpc("cc_my_book_requests", { p_limit: limit ?? 50 });
      bookRequestsQueue = (status) => rpc("cc_book_requests_queue", { p_status: status ?? "pending" });
      decideBookRequest = (id, action, note) => rpc("cc_decide_book_request", { p_id: id, p_action: action, p_note: note ?? null });
      pocketNotifications = (limit) => rpc("cc_pocket_notifications", { p_limit: limit ?? 50 });
      pocketMarkNotificationRead = (id) => rpc("cc_pocket_mark_notification_read", { p_id: id });
      pocketGetPreferences = () => rpc("cc_pocket_get_preferences");
      pocketSavePreferences = (p) => rpc("cc_pocket_save_preferences", { p });
      consentSummary = () => rpc("cc_consent_summary");
      pocketGetProfile = () => rpc("cc_pocket_get_profile");
      pocketSubmitOnboarding = () => rpc("cc_pocket_submit_onboarding");
      pocketSaveProfile = (p = {}) => rpc("update_my_carrier_profile", {
        p_company: p.company ?? null,
        p_contact_name: p.contactName ?? null,
        p_phone: p.phone ?? null,
        p_mc: p.mc ?? null,
        p_dot: p.dot ?? null,
        p_truck_count: p.truckCount ?? null,
        p_home_base: p.homeBase ?? null,
        p_radius_miles: p.radiusMiles ?? null,
        p_equipment_types: p.equipmentTypes ?? null,
        p_min_rpm: p.minRpm ?? null,
        p_max_deadhead: p.maxDeadhead ?? null,
        p_avoid_states: p.avoidStates ?? null,
        p_weekend_ok: p.weekendOk ?? null,
        p_hazmat: p.hazmat ?? null,
        p_owner_drives: p.ownerDrives ?? null,
        p_contact_method: p.contactMethod ?? null,
        p_whatsapp: p.whatsapp ?? null,
        p_factoring_status: p.factoringStatus ?? null,
        p_factoring_company: p.factoringCompany ?? null
      });
      carrierUploadDocument = async ({ type, fileName, filePath, aiVerdict = null }) => {
        const { getClient: getClient2 } = await Promise.resolve().then(() => (init_supabaseClient(), supabaseClient_exports));
        const sb = await getClient2();
        const { error } = await sb.from("documents").insert({ type, file_name: fileName, file_path: filePath, ...aiVerdict && typeof aiVerdict === "object" && !Array.isArray(aiVerdict) ? { ai_verdict: aiVerdict } : {} });
        if (error) throw new Error(error.message || "Could not save the document.");
        return true;
      };
      carrierListDocuments = async () => {
        const { getClient: getClient2 } = await Promise.resolve().then(() => (init_supabaseClient(), supabaseClient_exports));
        const sb = await getClient2();
        const { data, error } = await sb.from("documents").select("id,type,file_name,file_path,status,created_at,review_note,reviewed_at").order("created_at", { ascending: false }).limit(100);
        if (error) throw new Error(error.message || "Could not load documents.");
        return data || [];
      };
      pocketReportIssue = (trip, kind, note) => rpc("cc_pocket_report_issue", { p_trip: trip, p_kind: kind, p_note: note ?? null });
      pocketDisputeInvoice = (invoice, reason) => rpc("cc_pocket_dispute_invoice", { p_invoice: invoice, p_reason: reason });
      pocketUploadPod = (o = {}) => rpc("cc_pocket_upload_pod", { p_trip: o.trip, p_path: o.path, p_file_name: o.fileName ?? "POD", p_content_type: o.contentType ?? null, p_size: o.size ?? null });
      pocketTripPods = (trip) => rpc("cc_pocket_trip_pods", { p_trip: trip });
      pocketDrivers = () => rpc("cc_pocket_drivers");
      carrierLinkDriver = (fleetDriver, user) => rpc("cc_carrier_link_driver", { p_fleet_driver: fleetDriver, p_user: user });
      pocketUpsertDriver = (o = {}) => rpc("cc_pocket_upsert_driver", { p_id: o.id ?? null, p_name: o.name, p_phone: o.phone ?? null, p_email: o.email ?? null, p_license_no: o.licenseNo ?? null, p_license_state: o.licenseState ?? null, p_license_exp: o.licenseExp ?? null, p_medical_exp: o.medicalExp ?? null });
      pocketTrucks = () => rpc("cc_pocket_trucks");
      coiVehicles = () => rpc("cc_coi_vehicles");
      pocketUpsertTruck = (o = {}) => rpc("cc_pocket_upsert_truck", { p: {
        id: o.id ?? null,
        unit_no: o.unitNo,
        plate: o.plate ?? null,
        vin: o.vin ?? null,
        equipment: o.equipment ?? null,
        payload_lbs: o.payloadLbs ?? null,
        cargo_len_in: o.cargoLenIn ?? null,
        cargo_width_in: o.cargoWidthIn ?? null,
        cargo_height_in: o.cargoHeightIn ?? null,
        vin_make: o.vinMake ?? null,
        vin_model: o.vinModel ?? null,
        vin_year: o.vinYear ?? null,
        vin_gvwr: o.vinGvwr ?? null,
        vin_body: o.vinBody ?? null,
        domicile_city: o.domicileCity ?? null,
        domicile_state: o.domicileState ?? null,
        domicile_zip: o.domicileZip ?? null,
        door_type: o.doorType ?? null,
        door_width_in: o.doorWidthIn ?? null,
        door_height_in: o.doorHeightIn ?? null,
        deck_height_in: o.deckHeightIn ?? null,
        dock_high: o.dockHigh ?? null,
        liftgate: o.liftgate ?? null,
        liftgate_cap_lbs: o.liftgateCapLbs ?? null,
        has_pallet_jack: o.hasPalletJack ?? null,
        has_ramp: o.hasRamp ?? null,
        has_etrack: o.hasEtrack ?? null,
        has_load_bars: o.hasLoadBars ?? null,
        has_straps: o.hasStraps ?? null,
        has_blankets: o.hasBlankets ?? null,
        pallet_positions: o.palletPositions ?? null,
        wheel_well_width_in: o.wheelWellWidthIn ?? null,
        temp_control: o.tempControl ?? null,
        temp_min_f: o.tempMinF ?? null,
        temp_max_f: o.tempMaxF ?? null,
        hazmat_placarded: o.hazmatPlacarded ?? null,
        twic: o.twic ?? null,
        tsa_sta: o.tsaSta ?? null,
        bonded: o.bonded ?? null,
        team_driven: o.teamDriven ?? null,
        min_rpm: o.minRpm ?? null,
        max_radius_miles: o.maxRadiusMiles ?? null,
        home_time: o.homeTime ?? null,
        spec_note: o.specNote ?? null,
        trailer_type: o.trailerType ?? null,
        trailer_len_ft: o.trailerLenFt ?? null,
        trailer_vin: o.trailerVin ?? null,
        has_tarps: o.hasTarps ?? null,
        has_chains: o.hasChains ?? null
      } });
      vinCoverage = (vin) => rpc("cc_vin_coverage", { p_vin: vin });
      fleetFmcsaCheck = () => rpc("cc_fleet_fmcsa_check");
      setLegalOwner = (name) => rpc("cc_set_legal_owner", { p_name: name });
      truckLoadingProfiles = () => rpc("cc_truck_loading_profiles");
      breakeven = (weeklyCost, rpm) => rpc("cc_breakeven", { p_weekly_cost: weeklyCost ?? null, p_rpm: rpm ?? null });
      setCostAndLanes = (weeklyCost, includesPay, roundTrip) => rpc("cc_set_cost_and_lanes", { p_weekly_cost: weeklyCost ?? null, p_includes_pay: includesPay ?? null, p_round_trip: roundTrip ?? null });
      pocketTeam = () => rpc("cc_pocket_team");
      pocketSetMember = (o = {}) => rpc("cc_pocket_set_member", { p_user: o.user, p_role: o.role ?? null, p_status: o.status ?? null });
      pocketAssignTrip = (o = {}) => rpc("cc_pocket_assign_trip", { p_trip: o.trip, p_driver: o.driver ?? null, p_truck: o.truck ?? null });
      pocketStatement = () => rpc("cc_pocket_statement");
      pocketFleetAlerts = () => rpc("cc_pocket_fleet_alerts");
      pocketAdvanceTrip = (trip, status) => rpc("cc_pocket_advance_trip", { p_trip: trip, p_status: status });
      pocketTripTimeline = (trip) => rpc("cc_pocket_trip_timeline", { p_trip: trip });
      pocketMyExceptions = (limit) => rpc("cc_pocket_my_exceptions", { p_limit: limit ?? 50 });
      savePushSubscription = (o = {}) => rpc("cc_save_push_subscription", { p_endpoint: o.endpoint, p_p256dh: o.p256dh, p_auth: o.auth, p_label: o.label ?? null, p_ua: o.ua ?? null });
      revokePushSubscription = (endpoint) => rpc("cc_revoke_push_subscription", { p_endpoint: endpoint });
      VAPID_PUBLIC_KEY = "BMCVidsbziyvOFCZflK-uYgKxDR8DQizN6Z1ds2i1qGp2EqyT4M82wHoxiH5-hWIcQR6Sp3_P-Z20v5Yfp88x2c";
      sendPush = async (o = {}) => {
        const { getClient: getClient2 } = await Promise.resolve().then(() => (init_supabaseClient(), supabaseClient_exports));
        const sb = await getClient2();
        const { data, error } = await sb.functions.invoke("push-send", { body: { title: o.title, body: o.body, url: o.url ?? "/", audience: o.audience ?? null, user_ids: o.userIds ?? null, org: o.org ?? null } });
        if (error) throw new Error(error && error.message || "Push failed");
        if (data && data.error) throw new Error(data.error);
        return data;
      };
      opsRadar = () => rpc("cc_ops_radar");
      matchCarriers = (loadId) => rpc("cc_match_carriers_for_load", { p_load: loadId });
      globalSearch = (q, limit) => rpc("cc_global_search", { p_q: q, p_limit: limit ?? 20 });
      fleetOverview = () => rpc("cc_fleet_overview");
      listDrivers = (o = {}) => rpc("cc_list_drivers", { p_carrier: o.carrier ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      fleetExpiryBoard = (days) => rpc("cc_fleet_expiry_board", { p_days: days ?? 45 });
      partnerComplianceBoard = (days) => rpc("cc_partner_compliance_board", { p_days: days ?? 45 });
      packetSetDates = (org, key, expires, recheck) => rpc("cc_packet_set_dates", { p_org: org, p_key: key, p_expires: expires ?? null, p_recheck: recheck ?? null });
      authorityBoard = () => rpc("cc_authority_board");
      orgSetDocket = (org, mc, dot) => rpc("cc_org_set_docket", { p_org: org, p_mc: mc ?? null, p_dot: dot ?? null });
      contactsDirectory = (o = {}) => rpc("cc_contacts_directory", { p_search: o.search ?? null, p_kind: o.kind ?? null, p_limit: o.limit ?? 200 });
      warnDriverExpiry = (driver, kind) => rpc("cc_warn_driver_expiry", { p_driver: driver, p_kind: kind });
      listPermissionsFor = (userId) => rpc("cc_list_permissions_for", { p_user: userId });
      setUserPermission = (userId, perm, effect) => rpc("cc_set_user_permission", { p_user: userId, p_perm: perm, p_effect: effect });
      inviteStaff = (email, roleKey) => rpc("cc_invite_staff", { p_email: email, p_role_key: roleKey });
      listStaffInvites = () => rpc("cc_list_staff_invites");
      revokeStaffInvite = (id) => rpc("cc_revoke_staff_invite", { p_id: id });
      claimStaffInvite = () => rpc("cc_claim_staff_invite");
      upsertDriver = (o = {}) => rpc("cc_upsert_driver", { p_id: o.id ?? null, p_carrier: o.carrier, p_name: o.name, p_phone: o.phone ?? null, p_license_no: o.licenseNo ?? null, p_license_exp: o.licenseExp ?? null, p_medical_exp: o.medicalExp ?? null });
      upsertTruck = (o = {}) => rpc("cc_upsert_truck", { p_id: o.id ?? null, p_carrier: o.carrier, p_unit: o.unit, p_plate: o.plate ?? null, p_vin: o.vin ?? null, p_equipment: o.equipment ?? null });
      assignTripResources = (o = {}) => rpc("cc_assign_trip_resources", { p_trip: o.trip, p_driver: o.driver ?? null, p_truck: o.truck ?? null, p_trailer: o.trailer ?? null });
      addAccessorial = (trip, kind, amount, note) => rpc("cc_add_accessorial", { p_trip: trip, p_kind: kind, p_amount: amount, p_note: note ?? null });
      logException = (trip, kind, description) => rpc("cc_log_exception", { p_trip: trip, p_kind: kind, p_description: description });
      listExceptions = (o = {}) => rpc("cc_list_exceptions", { p_status: o.status ?? "open", p_limit: o.limit ?? 100 });
      resolveException = (o = {}) => rpc("cc_resolve_exception", { p_id: o.id, p_note: o.note ?? null });
      upsertCarrierSafety = (o = {}) => rpc("cc_upsert_carrier_safety", { p_carrier: o.carrier, p_dot: o.dot ?? null, p_mc: o.mc ?? null, p_authority: o.authority ?? null, p_rating: o.rating ?? null, p_power_units: o.powerUnits ?? null, p_oos: o.oos ?? null });
      safetyScorecard = (carrier) => rpc("cc_safety_scorecard", { p_carrier: carrier });
      addAdjustment = (o = {}) => rpc("cc_add_adjustment", { p_invoice: o.invoice ?? null, p_settlement: o.settlement ?? null, p_kind: o.kind, p_amount: o.amount, p_note: o.note ?? null });
      openDispute = (invoice, reason) => rpc("cc_open_dispute", { p_invoice: invoice, p_reason: reason });
      resolveDispute = (dispute, decision, resolution) => rpc("cc_resolve_dispute", { p_dispute: dispute, p_decision: decision, p_resolution: resolution ?? null });
      exportFinance = (kind) => rpc("cc_export_finance", { p_kind: kind ?? "invoices" });
      carrierStatement = (carrier) => rpc("cc_carrier_statement", { p_carrier: carrier });
      pocketSetConsent = (trip, consent) => rpc("cc_pocket_set_consent", { p_trip: trip, p_consent: consent });
      pocketPostLocation = (trip, lat, lng, label) => rpc("cc_pocket_post_location", { p_trip: trip, p_lat: lat, p_lng: lng, p_label: label ?? null });
      tripSetDriving = (trip, ownerDriving) => rpc("cc_trip_set_driving", { p_trip: trip, p_owner_driving: !!ownerDriving });
      tripLocations = (trip, limit) => rpc("cc_trip_locations", { p_trip: trip, p_limit: limit ?? 50 });
      laneHistory = (limit) => rpc("cc_lane_history", { p_limit: limit ?? 30 });
      managementDashboard = () => rpc("cc_management_dashboard");
      invoiceDocument = (invoice) => rpc("cc_invoice_document", { p_invoice: invoice });
      rateconDocument = (trip) => rpc("cc_ratecon_document", { p_trip: trip });
      listDocumentFiles = (ownerType, ownerId) => rpc("cc_list_document_files", { p_owner_type: ownerType, p_owner_id: ownerId });
      recordDocumentFile = (o = {}) => rpc("cc_record_document_file", { p_owner_type: o.ownerType, p_owner_id: o.ownerId, p_kind: o.kind ?? null, p_path: o.path, p_file_name: o.fileName, p_content_type: o.contentType ?? null, p_size: o.size ?? null });
      podReviewQueue = (o = {}) => rpc("cc_pod_review_queue", { p_status: o.status ?? "pending", p_limit: o.limit ?? 100 });
      podSignedRef = (docId) => rpc("cc_pod_signed_ref", { p_doc: docId });
      reviewPod = (o = {}) => rpc("cc_review_pod", { p_doc: o.doc, p_decision: o.decision, p_reason: o.reason ?? null });
      webLive = (minutes = 5) => rpc("cc_web_live", { p_minutes: minutes });
      webOverview = (days = 7) => rpc("cc_web_overview", { p_days: days });
      webPages = (days = 7, limit = 25) => rpc("cc_web_pages", { p_days: days, p_limit: limit });
      webReferrers = (days = 7, limit = 25) => rpc("cc_web_referrers", { p_days: days, p_limit: limit });
      webAiReferrals = (days = 30) => rpc("cc_web_ai_referrals", { p_days: days });
      formsOverview = () => rpc("cc_forms_overview");
      listForms = (o = {}) => rpc("cc_list_forms", { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      getForm = (id) => rpc("cc_get_form", { p_id: id });
      convertFormToLead = (id) => rpc("cc_convert_form_to_lead", { p_id: id });
      setFormStatus = (id, status, assignee) => rpc("cc_set_form_status", { p_id: id, p_status: status, p_assignee: assignee ?? null });
      seoOverview = () => rpc("cc_seo_overview");
      listKeywords = (o = {}) => rpc("cc_list_keywords", { p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      upsertKeyword = (o = {}) => rpc("cc_upsert_keyword", { p_id: o.id ?? null, p_keyword: o.keyword, p_target_page: o.targetPage ?? null, p_position: o.position ?? null, p_priority: o.priority ?? null, p_intent: o.intent ?? null, p_notes: o.notes ?? null });
      listRedirects = (limit = 300) => rpc("cc_list_redirects", { p_limit: limit });
      createRedirect = (o = {}) => rpc("cc_create_redirect", { p_source: o.source, p_destination: o.destination, p_type: o.type ?? 301, p_reason: o.reason ?? null });
      toggleRedirect = (id, active) => rpc("cc_toggle_redirect", { p_id: id, p_active: active });
      integrationStatus = () => rpc("cc_integration_status");
      setIntegrationStatus = (provider, status, config) => rpc("cc_set_integration_status", { p_provider: provider, p_status: status, p_config: config ?? null });
      carrier360 = (org) => rpc("cc_carrier_360", { p_org: org });
      entityAudit = (o = {}) => rpc("cc_entity_audit", { p_target_type: o.targetType ?? null, p_target_id: o.targetId ?? null, p_org: o.org ?? null, p_limit: o.limit ?? 60 });
      partnersOverview = () => rpc("cc_partners_overview");
      listPartners = (o = {}) => rpc("cc_list_partners", { p_kind: o.kind ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      getPartner = (id) => rpc("cc_get_partner", { p_id: id });
      upsertPartner = (o = {}) => rpc("cc_upsert_partner", { p_id: o.id ?? null, p_kind: o.kind, p_name: o.name, p_mc: o.mc ?? null, p_contact_name: o.contactName ?? null, p_email: o.email ?? null, p_phone: o.phone ?? null, p_billing_terms: o.billingTerms ?? null, p_credit_limit: o.creditLimit ?? null, p_notes: o.notes ?? null });
      setPartnerStatus = (id, status) => rpc("cc_set_partner_status", { p_id: id, p_status: status });
      supportOverview = () => rpc("cc_support_overview");
      listTickets = (o = {}) => rpc("cc_list_tickets", { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
      getTicket = (id) => rpc("cc_get_ticket", { p_id: id });
      createTicket = (o = {}) => rpc("cc_create_ticket", { p_subject: o.subject, p_body: o.body ?? null, p_requester_name: o.requesterName ?? null, p_requester_email: o.requesterEmail ?? null, p_priority: o.priority ?? "normal", p_category: o.category ?? null, p_related_type: o.relatedType ?? null, p_related_id: o.relatedId ?? null });
      setTicketStatus = (id, status, assignee) => rpc("cc_set_ticket_status", { p_id: id, p_status: status, p_assignee: assignee ?? null });
      report = (kind, days = 30) => rpc("cc_report", { p_kind: kind, p_days: days });
      listRules = () => rpc("cc_list_rules");
      setRuleEnabled = (key, enabled) => rpc("cc_set_rule_enabled", { p_key: key, p_enabled: enabled });
      actionCenter = () => rpc("cc_action_center");
      opsMap = () => rpc("cc_ops_map");
      ga4Insights = async (days = 28) => {
        const { getClient: getClient2 } = await Promise.resolve().then(() => (init_supabaseClient(), supabaseClient_exports));
        const sb = await getClient2();
        const { data, error } = await sb.functions.invoke("ga4-insights", { body: { days } });
        if (error) throw new Error(error && error.message || "GA4 request failed");
        return data;
      };
      gscInsights = async (days = 28) => {
        const { getClient: getClient2 } = await Promise.resolve().then(() => (init_supabaseClient(), supabaseClient_exports));
        const sb = await getClient2();
        const { data, error } = await sb.functions.invoke("gsc-insights", { body: { days } });
        if (error) throw new Error(error && error.message || "Search Console request failed");
        return data;
      };
      ccEmailLoads = (status = null) => rpc("cc_email_loads", { p_status: status });
      ccEmailBrokerVerify = (id, approve) => rpc("cc_email_broker_verify", { p_broker_id: id, p_approve: approve });
      createAnnouncement = (o = {}) => rpc("cc_create_announcement", { p_title: o.title, p_body: o.body ?? null, p_kind: o.kind ?? "info", p_audience: o.audience ?? "all_carriers", p_target_org: o.targetOrg ?? null, p_expires_at: o.expiresAt ?? null });
      listAnnouncements = (limit = 100) => rpc("cc_list_announcements", { p_limit: limit });
      setAnnouncementActive = (id, active) => rpc("cc_set_announcement_active", { p_id: id, p_active: active });
      pocketAnnouncements = () => rpc("cc_pocket_announcements");
      createCampaign = (o = {}) => rpc("cc_create_campaign", { p_name: o.name, p_source: o.source ?? null, p_medium: o.medium ?? null, p_campaign: o.campaign, p_landing: o.landing ?? "/" });
      listCampaigns = (limit = 100) => rpc("cc_list_campaigns", { p_limit: limit });
      setCampaignActive = (id, active) => rpc("cc_set_campaign_active", { p_id: id, p_active: active });
      aiAssist = async (task, ctx = {}) => {
        const { getClient: getClient2 } = await Promise.resolve().then(() => (init_supabaseClient(), supabaseClient_exports));
        const sb = await getClient2();
        const { data, error } = await sb.functions.invoke("ai-assist", { body: { task, ...ctx } });
        if (error) throw new Error(error && error.message || "AI request failed");
        if (data && data.error) throw new Error(data.error);
        return data;
      };
      sendEmail = async (o = {}) => {
        const { getClient: getClient2 } = await Promise.resolve().then(() => (init_supabaseClient(), supabaseClient_exports));
        const sb = await getClient2();
        const { data, error } = await sb.functions.invoke("send-email", { body: { to: o.to, subject: o.subject, text: o.text, html: o.html ?? null } });
        if (error) throw new Error(error && error.message || "Email failed");
        if (data && data.error) throw new Error(data.error);
        return data;
      };
      fmcsaVerify = async (o = {}) => {
        const { getClient: getClient2 } = await Promise.resolve().then(() => (init_supabaseClient(), supabaseClient_exports));
        const sb = await getClient2();
        const _invoke = sb.functions.invoke("fmcsa-verify", { body: { carrier_org: o.carrierOrg ?? null, dot: o.dot ?? null, mc: o.mc ?? null } });
        const _timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("FMCSA is taking too long. Please try again, or upload your authority letter (PDF) instead.")), 25e3));
        const { data, error } = await Promise.race([_invoke, _timeout]);
        if (error) {
          const e = new Error(error && error.message || "FMCSA verification failed");
          e.fn = "fmcsa-verify";
          throw e;
        }
        if (data && data.error) throw new Error(data.error);
        return data;
      };
      listCarrierOrgs = () => rpc("cc_list_carrier_orgs");
      postChat = (body, name) => rpc("cc_post_chat", { p_body: body, p_name: name ?? null });
      listChat = (after = 0, limit = 100) => rpc("cc_list_chat", { p_after: after, p_limit: limit });
      partnerRegister = (kind, company, mc) => rpc("cc_partner_register", { p_kind: kind, p_company: company, p_mc: mc ?? null });
      partnerBrokerScreen = (mc, dot) => rpc("partner_broker_screen", { p_mc: mc ?? null, p_dot: dot ?? null });
      partnerAgentDeclare = (parentMc, parentCompany, contactEmail) => rpc("partner_agent_declare", { p_parent_mc: parentMc, p_parent_company: parentCompany ?? null, p_contact_email: contactEmail ?? null });
      partnerTrustStatus = () => rpc("partner_trust_status");
      partnerAgentConfirmGet = (token) => rpc("partner_agent_confirm_get", { p_token: token });
      partnerAgentConfirm = (token, decision, name, note) => rpc("partner_agent_confirm", { p_token: token, p_decision: decision, p_name: name ?? null, p_note: note ?? null });
      ccBrokerTrustQueue = () => rpc("cc_broker_trust_queue");
      ccBrokerTrustSet = (org, action, note) => rpc("cc_broker_trust_set", { p_org: org, p_action: action, p_note: note ?? null });
      partnerIdentityResend = () => rpc("partner_identity_resend");
      partnerIdentityRequestCall = (phone, note) => rpc("partner_identity_request_call", { p_phone: phone ?? null, p_note: note ?? null });
      partnerAgentsList = () => rpc("partner_agents_list");
      partnerAgentDecide = (agentOrg, decision, note) => rpc("partner_agent_decide", { p_agent_org: agentOrg, p_decision: decision, p_note: note ?? null });
      partnerAgentInvite = (email, name) => rpc("partner_agent_invite", { p_email: email, p_name: name ?? null });
      partnerAgentInviteRevoke = (id) => rpc("partner_agent_invite_revoke", { p_id: id });
      partnerAgentParentRemove = (id) => rpc("partner_agent_parent_remove", { p_id: id });
      partnerAgentParentResend = (id) => rpc("partner_agent_parent_resend", { p_id: id });
      partnerShipperStatus = () => rpc("partner_shipper_status");
      partnerShipperVerify = () => rpc("partner_shipper_verify");
      partnerShipperCompanyEmail = (email) => rpc("partner_shipper_company_email", { p_email: email });
      ccShipperTrustQueue = () => rpc("cc_shipper_trust_queue");
      ccShipperTrustSet = (org, action, note) => rpc("cc_shipper_trust_set", { p_org: org, p_action: action, p_note: note ?? null });
      partnerClaimGet = (token) => rpc("partner_claim_get", { p_token: token });
      partnerClaimConfirm = (token, decision, name, note) => rpc("partner_claim_confirm", { p_token: token, p_decision: decision, p_name: name ?? null, p_note: note ?? null });
      partnerVerifyCall = (purpose) => rpc("partner_verify_call", { p_purpose: purpose });
      partnerVerifyCode = (code) => rpc("partner_verify_code", { p_code: code });
      partnerOverview = () => rpc("cc_partner_overview");
      partnerPostLoad = (o = {}) => rpc("cc_partner_post_load", { p_origin: o.origin, p_destination: o.destination, p_equipment: o.equipment ?? null, p_rate: o.rate ?? null, p_miles: o.miles ?? null, p_pickup: o.pickup ?? null, p_weight: o.weight ?? null, p_commodity: o.commodity ?? null, p_notes: o.notes ?? null, p_idempotency_key: o.idempotencyKey ?? null, p_origin_full: o.originFull ?? null, p_destination_full: o.destinationFull ?? null, p_pickup_lat: o.pickupLat ?? null, p_pickup_lng: o.pickupLng ?? null, p_delivery_lat: o.deliveryLat ?? null, p_delivery_lng: o.deliveryLng ?? null });
      partnerMyLoads = (limit) => rpc("cc_partner_my_loads", { p_limit: limit ?? 50 });
      partnerSubmitLoad = (o = {}) => rpc("cc_partner_submit_load", { p: o });
      partnerCarrierDirectory = () => rpc("cc_partner_carrier_directory");
      partnerCarrierCapacity = (ids) => rpc("cc_partner_carrier_capacity", { p_carriers: ids });
      loadPickupStatus = (load) => rpc("cc_load_pickup_status", { p_load: load });
      myCapacity = () => rpc("cc_my_capacity");
      myFreeTrucks = () => rpc("cc_my_free_trucks");
      partnerCarrierReviews = (org) => rpc("cc_partner_carrier_reviews", { p_org: org });
      partnerLoadFull = (loadId) => rpc("cc_partner_load_full", { p_load: loadId });
      partnerTrackLoad = (loadId) => rpc("cc_partner_track_load", { p_load: loadId });
      pocketTripDocs = (tripId) => rpc("cc_pocket_trip_docs", { p_trip: tripId });
      partnerEligibleDetail = (loadId) => rpc("cc_partner_eligible_detail", { p_load: loadId });
      requestPacketCopies = (tripId) => rpc("cc_request_packet_copies", { p_trip: tripId });
      partnerCarrierPacket = (loadId) => rpc("cc_partner_carrier_packet", { p_load: loadId });
      ccAskReschedule = (id) => rpc("cc_ask_reschedule", { p_id: id });
      partnerExtendOffer = (loadId, minutes) => rpc("cc_partner_extend_offer", { p_load: loadId, p_minutes: minutes ?? 15 });
      partnerOfferWithdraw = (loadId) => rpc("cc_partner_offer_withdraw", { p_load: loadId });
      marketRpm = () => rpc("cc_market_rpm");
      laneRate = (o, d2, eq, miles) => rpc("cc_lane_rate", { p_o_state: o ?? null, p_d_state: d2 ?? null, p_equipment: eq, p_miles: miles ?? null });
      publicMarketRates = () => rpc("get_public_market_rates");
      setOrgLogo = (path) => rpc("cc_set_org_logo", { p_path: path });
      loadChecklist = (subjectType, subjectId) => rpc("cc_load_checklist", { p_subject_type: subjectType, p_subject_id: subjectId });
      loadChecklistSet = (id, status) => rpc("cc_load_checklist_set", { p_id: id, p_status: status });
      partnerRequestShipment = (o = {}) => rpc("cc_partner_request_shipment", { p_origin: o.origin, p_destination: o.destination, p_ready: o.ready ?? null, p_equipment: o.equipment ?? null, p_weight: o.weight ?? null, p_commodity: o.commodity ?? null, p_pieces: o.pieces ?? null, p_accessorials: o.accessorials ?? null, p_notes: o.notes ?? null, p_facility_notes: o.facility_notes ?? null, p_dock_hours: o.dock_hours ?? null, p_appointment_required: o.appointment_required ?? false });
      partnerMyShipments = (limit) => rpc("cc_partner_my_shipments", { p_limit: limit ?? 50 });
      partnerCreateAppointment = (o = {}) => rpc("cc_partner_create_appointment", { p_direction: o.direction ?? "inbound", p_window_start: o.windowStart, p_window_end: o.windowEnd ?? null, p_dock: o.dock ?? null, p_carrier_name: o.carrierName ?? null, p_reference: o.reference ?? null, p_notes: o.notes ?? null });
      partnerAppointments = (limit) => rpc("cc_partner_appointments", { p_limit: limit ?? 100 });
      partnerSetAppointmentStatus = (id, status) => rpc("cc_partner_set_appointment_status", { p_id: id, p_status: status });
      partnerIntakeOverview = () => rpc("cc_partner_intake_overview");
      listPartnerLoads = (o = {}) => rpc("cc_list_partner_loads", { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
      decidePartnerLoad = (id, action) => rpc("cc_decide_partner_load", { p_id: id, p_action: action });
      partnerLoadReview = (id) => rpc("cc_partner_load_review", { p_id: id });
      listPartnerShipments = (o = {}) => rpc("cc_list_partner_shipments", { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
      decidePartnerShipment = (id, action) => rpc("cc_decide_partner_shipment", { p_id: id, p_action: action });
      listPartnerAppointmentsAll = (limit) => rpc("cc_list_partner_appointments_all", { p_limit: limit ?? 200 });
      createPartnerInvoice = (o = {}) => rpc("cc_create_partner_invoice", { p_partner_org: o.org, p_amount: o.amount, p_description: o.description ?? null, p_due: o.due ?? null });
      listPartnerInvoicesAll = (o = {}) => rpc("cc_list_partner_invoices_all", { p_status: o.status ?? null, p_limit: o.limit ?? 200 });
      setPartnerInvoiceStatus = (id, status) => rpc("cc_set_partner_invoice_status", { p_id: id, p_status: status });
      partnerMyInvoices = (limit) => rpc("cc_partner_my_invoices", { p_limit: limit ?? 100 });
      listPartnerOrgs = () => rpc("cc_list_partner_orgs");
      partnerNotifications = (limit) => rpc("cc_partner_notifications", { p_limit: limit ?? 50 });
      partnerMarkNotificationRead = (id) => rpc("cc_partner_mark_notification_read", { p_id: id });
      partnerMarkAllNotificationsRead = () => rpc("cc_partner_mark_all_notifications_read");
      pocketMarkAllNotificationsRead = () => rpc("cc_pocket_mark_all_notifications_read");
      partnerGetProfile = () => rpc("cc_partner_get_profile");
      partnerUpdateProfile = (o = {}) => rpc("cc_partner_update_profile", { p_company: o.company, p_contact_name: o.contactName ?? null, p_phone: o.phone ?? null, p_email: o.email ?? null, p_address: o.address ?? null });
      createApiKey = (name, scopes) => rpc("cc_create_api_key", { p_name: name, p_scopes: scopes ?? ["read"] });
      listApiKeys = () => rpc("cc_list_api_keys");
      revokeApiKey = (id) => rpc("cc_revoke_api_key", { p_id: id });
      getPaymentInstructions = () => rpc("cc_get_payment_instructions");
      setPaymentInstructions = (text) => rpc("cc_set_payment_instructions", { p_text: text });
      partnerSubmitInvoicePayment = (id, proofPath, expectedDate, ref, note) => rpc("cc_partner_submit_invoice_payment", { p_id: id, p_proof_path: proofPath ?? null, p_expected_date: expectedDate ?? null, p_ref: ref ?? null, p_note: note ?? null });
      recordCarrierVerification = (carrier, result) => rpc("cc_record_carrier_verification", { p_carrier: carrier, p_result: result });
      listCarrierVerifications = (o = {}) => rpc("cc_list_carrier_verifications", { p_carrier: o.carrier ?? null, p_limit: o.limit ?? 100 });
      verificationQueue = (limit) => rpc("cc_verification_queue", { p_limit: limit ?? 100 });
      getBrandKit = () => rpc("cc_get_brand_kit");
      setBrandKit = (data) => rpc("cc_set_brand_kit", { p_data: data });
      saveCustomForm = (o = {}) => rpc("cc_save_custom_form", { p_key: o.key, p_title: o.title, p_description: o.description ?? null, p_fields: o.fields ?? [], p_thank_you: o.thankYou ?? null, p_redirect: o.redirect ?? null, p_status: o.status ?? "draft" });
      listCustomForms = () => rpc("cc_list_custom_forms");
      listPlugins = () => rpc("cc_list_plugins");
      listInstalledPlugins = () => rpc("cc_list_installed_plugins");
      installPlugin = (id, config) => rpc("cc_install_plugin", { p_plugin: id, p_config: config ?? {} });
      setPluginEnabled = (id, enabled) => rpc("cc_set_plugin_enabled", { p_id: id, p_enabled: enabled });
      uninstallPlugin = (id) => rpc("cc_uninstall_plugin", { p_id: id });
      api_default = { rpc };
      setMyAvatar = (path) => rpc("cc_set_my_avatar", { p_path: path });
      myAvatar = () => rpc("cc_my_avatar");
      runComplianceExpirySweep = (days) => rpc("cc_run_compliance_expiry_sweep", { p_days: days ?? 30 });
      runStaleBookreqSweep = (days) => rpc("cc_run_stale_bookreq_sweep", { p_days: days ?? 5 });
      emergencyContacts = () => rpc("cc_emergency_contacts", {});
      emergencyContactAdd = (name, relation, phone) => rpc("cc_emergency_contact_add", { p_name: name, p_relation: relation, p_phone: phone });
      emergencyContactDelete = (id) => rpc("cc_emergency_contact_delete", { p_id: id });
      reportTripIncident = (o) => rpc("cc_report_trip_incident", { p_trip: o.trip, p_type: o.type, p_need: o.need, p_note: o.note ?? null, p_lat: o.lat, p_lng: o.lng, p_accuracy: o.accuracy ?? null, p_location: o.location ?? null, p_proofs: o.proofs ?? [] });
      myTripIncidents = (trip) => rpc("cc_my_trip_incidents", { p_trip: trip ?? null });
      safetyIncidents = (status) => rpc("cc_safety_incidents", { p_status: status ?? null });
      ackIncident = (id) => rpc("cc_ack_incident", { p_id: id });
      approveIncidentReschedule = (id, win, note) => rpc("cc_approve_incident_reschedule", { p_id: id, p_new_window: win, p_note: note ?? null });
      fuelPricesGet = () => rpc("fuel_prices_get");
      deviceSeen = (key, label, ua) => rpc("device_seen", { p_key: key, p_label: label ?? null, p_ua: ua ?? null });
      myDevices = () => rpc("my_devices");
      facilityReviewSubmit = (trip, kind, stars, comment) => rpc("facility_review_submit", { p_trip: trip, p_kind: kind, p_stars: stars, p_comment: comment ?? null });
      facilityRatings = (keys) => rpc("facility_ratings", { p_keys: keys });
      staffTrackLoad = (loadId) => rpc("cc_staff_track_load", { p_load: loadId });
      ccCarrierFleet360 = (orgId) => rpc("cc_carrier_fleet_360", { p_org: orgId });
      driverPermissionCatalog = () => rpc("cc_driver_permission_catalog");
      driverAccessList = () => rpc("cc_driver_access_list");
      carrierInviteDriver = (fleetDriver, email, phone, perms, preset, via) => rpc("cc_carrier_invite_driver", { p_fleet_driver: fleetDriver, p_email: email ?? null, p_phone: phone ?? null, p_perms: perms ?? null, p_preset: preset || "driver", p_via: via || ["email"] });
      driverInviteResend = (inviteId) => rpc("cc_driver_invite_resend", { p_invite: inviteId });
      driverInviteRevoke = (inviteId) => rpc("cc_driver_invite_revoke", { p_invite: inviteId });
      driverInvitePeek = (token) => rpc("cc_driver_invite_peek", { p_token: token });
      acceptDriverInvite = (token, platform) => rpc("cc_accept_driver_invite", { p_token: token, p_platform: platform ?? null });
      driverGrantsGet = (userId) => rpc("cc_driver_grants_get", { p_user: userId });
      driverGrantsSet = (userId, perms, preset) => rpc("cc_driver_grants_set", { p_user: userId, p_perms: perms || [], p_preset: preset ?? null });
      driverSetStatus = (userId, status) => rpc("cc_driver_set_status", { p_user: userId, p_status: status });
      driverOrgSettings = (requireAndroidApp) => rpc("cc_driver_org_settings", { p_require_android_app: requireAndroidApp ?? null });
      driverDocsForOwner = (fleetDriver) => rpc("cc_driver_docs_for_owner", { p_fleet_driver: fleetDriver ?? null });
      driverDocReview = (docId, status, note) => rpc("cc_driver_doc_review", { p_doc: docId, p_status: status, p_note: note ?? null });
      myDriverContext = () => rpc("cc_my_driver_context");
      driverHeartbeat = (o = {}) => rpc("cc_driver_heartbeat", { p_platform: o.platform ?? null, p_standalone: o.standalone ?? null, p_device: o.device ?? null, p_location_on: o.locationOn ?? null });
      driverUpdateMyProfile = (o = {}) => rpc("cc_driver_update_my_profile", { p_phone: o.phone ?? null, p_avatar_path: o.avatarPath ?? null });
      driverMyDocs = () => rpc("cc_driver_my_docs");
      driverDocUpload = (o = {}) => rpc("cc_driver_doc_upload", { p_kind: o.kind, p_path: o.path, p_file_name: o.fileName ?? null, p_content_type: o.contentType ?? null, p_size: o.size ?? null, p_expires_on: o.expiresOn ?? null });
      driverMyEarnings = (days) => rpc("cc_driver_my_earnings", { p_days: days ?? 30 });
      driverMySettlements = () => rpc("cc_driver_my_settlements");
      ccCarrierDriverAccess = (orgId) => rpc("cc_carrier_driver_access", { p_org: orgId });
      ccDriverAdoptionKpis = () => rpc("cc_driver_adoption_kpis");
      dialerBootstrap = () => rpc("dialer_bootstrap", {});
      dialerHeartbeat = () => rpc("dialer_heartbeat", {});
      dialerForwardSet = (number) => rpc("dialer_forward_set", { p_number: number ?? "" });
      dialerLookup = (number) => rpc("dialer_lookup", { p_number: number });
      dialerCallStart = (p) => rpc("dialer_call_start", { p: p ?? {} });
      dialerCallUpdate = (id, p) => rpc("dialer_call_update", { p_id: id, p: p ?? {} });
      dialerCallTag = (id, p) => rpc("dialer_call_tag", { p_id: id, p: p ?? {} });
      dialerCallbackSet = (id, status) => rpc("dialer_callback_set", { p_id: id, p_status: status });
      dialerHistory = (limit, before, q) => rpc("dialer_history", { p_limit: limit ?? 50, p_before: before ?? null, p_q: q ?? null });
      ccDialerOverview = () => rpc("cc_dialer_overview", {});
      ccDialerCalls = (p) => rpc("cc_dialer_calls", { p: p ?? {} });
      dialerSmsThreads = () => rpc("dialer_sms_threads", {});
      dialerSmsThread = (number, before) => rpc("dialer_sms_thread", { p_number: number, p_before: before ?? null });
      ccDialerSms = (p) => rpc("cc_dialer_sms", { p: p ?? {} });
      ccDialerLineUpsert = (p) => rpc("cc_dialer_line_upsert", { p: p ?? {} });
      ccDialerLineRelease = (lineId) => rpc("cc_dialer_line_release", { p_line: lineId });
      ccDialerConfigSet = (p) => rpc("cc_dialer_config_set", { p: p ?? {} });
      dmailBootstrap = (account) => rpc("dmail_bootstrap", { p_account: account ?? null });
      dmailList = (p) => rpc("dmail_list", { p: p ?? {} });
      dmailThread = (account, thread, folder) => rpc("dmail_thread", { p_account: account, p_thread: thread, p_folder: folder ?? null });
      dmailDraftSave = (p) => rpc("dmail_draft_save", { p: p ?? {} });
      dmailDraftDiscard = (id) => rpc("dmail_draft_discard", { p_id: id });
      dmailPoll = (account) => rpc("dmail_poll", { p_account: account });
      dmailContacts = (account, q) => rpc("dmail_contacts", { p_account: account, p_q: q ?? "" });
      ccDmailOverview = () => rpc("cc_dmail_overview", {});
      ccDmailActivity = (p) => rpc("cc_dmail_activity", { p: p ?? {} });
      ccDmailAccountSave = (p) => rpc("cc_dmail_account_save", { p: p ?? {} });
      ccDmailAssign = (account, user) => rpc("cc_dmail_assign", { p_account: account, p_user: user ?? null });
      ccDmailSetStatus = (account, status) => rpc("cc_dmail_set_status", { p_account: account, p_status: status });
    }
  });

  // mnt/loadboot/app/shared/ui/dom.js
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "dataset") for (const d in v) node.dataset[d] = v[d];
      else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    if (children != null) appendChildren(node, children);
    return node;
  }
  function appendChildren(node, children) {
    if (children == null || children === false || children === "") return;
    if (Array.isArray(children)) children.forEach((c) => appendChildren(node, c));
    else if (children instanceof Node) node.appendChild(children);
    else node.appendChild(document.createTextNode(String(children)));
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function mount(node, child) {
    clear(node);
    appendChildren(node, child);
  }

  // mnt/loadboot/app/shared/dmail.js
  var IC = {
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    draft: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    spam: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M12 8v4M12 16h.01"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    reply: '<path d="m9 14-5-5 5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>',
    replyall: '<path d="m7 14-5-5 5-5"/><path d="m12 14-5-5 5-5"/><path d="M7 9h8a6 6 0 0 1 6 6v4"/>',
    forward: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v4"/>',
    clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    min: '<path d="M5 19h14"/>',
    max: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    mailopen: '<path d="M21.2 8.4A2 2 0 0 1 22 10v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>',
    italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
    under: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 21h16"/>',
    ul: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    ol: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.700 1.700"/><path d="M14 11a5 5 0 0 0-7.500-.5l-3 3a5 5 0 0 0 7 7l1.700-1.700"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.700 3h17a2 2 0 0 0 1.700-3L13.700 3.900a2 2 0 0 0-3.400 0z"/><path d="M12 9v4M12 17h.01"/>'
  };
  var ic = (n, s = 18, fill) => el("span", { class: "dm-ic", "aria-hidden": "true", html: '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="' + (fill || "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (IC[n] || "") + "</svg>" });
  var CSS = `
.dm{--bg:#0b1626;--panel:#0f1e33;--panel2:#13263f;--line:rgba(255,255,255,.08);--ink:#eaf1fb;--ink2:#9db0c9;--ink3:#6f84a1;--blue:#0883F7;--orange:#FC5305;--navy:#10223B;
  position:relative;display:grid;grid-template-columns:232px minmax(0,1fr);gap:14px;min-height:72vh;color:var(--ink);font-size:.92rem;-webkit-font-smoothing:antialiased}
.dm *{box-sizing:border-box}.dm-ic{display:inline-flex;flex:0 0 auto}.dm button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.dm-rail{display:flex;flex-direction:column;gap:4px;padding:4px 0}
.dm-compose{display:flex;align-items:center;gap:10px;justify-content:center;border:0;border-radius:16px;padding:14px 18px;margin:0 0 12px;font-weight:800;color:#fff;background:linear-gradient(135deg,#0883F7,#0a6fd6);box-shadow:0 14px 28px -14px rgba(8,131,247,.75);transition:transform .12s,box-shadow .12s}
.dm-compose:hover{transform:translateY(-1px);box-shadow:0 18px 32px -14px rgba(8,131,247,.9)}
.dm-f{display:flex;align-items:center;gap:12px;border:0;background:transparent;border-radius:999px;padding:9px 14px;color:var(--ink2);font-weight:700;text-align:left;transition:background .12s}
.dm-f:hover{background:rgba(255,255,255,.05);color:var(--ink)}.dm-f.on{background:rgba(8,131,247,.16);color:#fff}
.dm-f .n{margin-left:auto;font-size:.76rem;font-weight:800;color:var(--ink)}.dm-f.on .n{color:#fff}
.dm-who{margin-top:auto;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--panel);font-size:.78rem;color:var(--ink3);overflow:hidden}
.dm-who b{display:block;color:var(--ink);font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-who .s{display:flex;align-items:center;gap:6px;margin-top:6px}.dm-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.16)}.dm-dot.bad{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.16)}
.dm-main{min-width:0;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;background:var(--panel);overflow:hidden}
.dm-top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.03),transparent)}
.dm-search{flex:1;display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:9px 16px;color:var(--ink3);transition:border-color .12s,box-shadow .12s}
.dm-search:focus-within{border-color:rgba(8,131,247,.6);box-shadow:0 0 0 3px rgba(8,131,247,.15)}
.dm-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--ink);font:inherit}.dm-search input::placeholder{color:var(--ink3)}
.dm-ib{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:var(--ink2);transition:background .12s,color .12s}
.dm-ib:hover{background:rgba(255,255,255,.08);color:#fff}.dm-ib:disabled{opacity:.4;cursor:default}.dm-ib.spin .dm-ic{animation:dmspin .8s linear infinite}@keyframes dmspin{to{transform:rotate(360deg)}}
.dm-bar{display:flex;align-items:center;gap:4px;padding:6px 10px;border-bottom:1px solid var(--line);min-height:48px;color:var(--ink3);font-size:.8rem}
.dm-bar .sp{flex:1}.dm-chk{width:18px;height:18px;accent-color:#0883F7;cursor:pointer;margin:0 9px}
.dm-list{flex:1;overflow:auto}.dm-row{position:relative;display:grid;grid-template-columns:auto auto minmax(120px,210px) minmax(0,1fr) auto;align-items:center;gap:6px;padding:0 14px 0 6px;min-height:46px;border-bottom:1px solid rgba(255,255,255,.045);cursor:pointer;color:var(--ink2);transition:background .1s,box-shadow .1s}
.dm-row:hover{background:rgba(255,255,255,.035);box-shadow:inset 3px 0 0 var(--blue)}.dm-row.un{background:rgba(8,131,247,.06);color:var(--ink)}.dm-row.un .who,.dm-row.un .sub{font-weight:800;color:#fff}.dm-row.sel{background:rgba(8,131,247,.16)}
.dm-row .who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-row .who i{font-style:normal;color:var(--ink3);font-weight:600;font-size:.8rem;margin-left:5px}.dm-row .who .dr{color:var(--orange);font-weight:800}
.dm-row .txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.dm-row .txt .sn{color:var(--ink3);font-weight:500}
.dm-row .meta{display:flex;align-items:center;gap:8px;font-size:.78rem;color:var(--ink3);white-space:nowrap}.dm-row.un .meta{color:#fff;font-weight:800}
.dm-row .acts{display:none;gap:0}.dm-row:hover .acts{display:flex}.dm-row:hover .meta .d{display:none}
.dm-starb{border:0;background:transparent;padding:6px;color:var(--ink3);display:inline-flex;border-radius:50%}.dm-starb:hover{background:rgba(255,255,255,.08)}.dm-starb.on{color:#fbbf24}
.dm-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:70px 20px;color:var(--ink3);text-align:center}.dm-empty .big{width:64px;height:64px;border-radius:20px;display:flex;align-items:center;justify-content:center;background:rgba(8,131,247,.12);color:#5fb0ff}.dm-empty b{color:var(--ink);font-size:1.02rem}
.dm-sk{height:46px;border-bottom:1px solid rgba(255,255,255,.045);background:linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent);background-size:200% 100%;animation:dmsk 1.2s infinite}@keyframes dmsk{to{background-position:-200% 0}}
.dm-more{display:block;margin:14px auto;border:1px solid var(--line);background:transparent;border-radius:999px;padding:8px 18px;color:var(--ink2);font-weight:700}.dm-more:hover{background:rgba(255,255,255,.05)}
.dm-banner{display:flex;align-items:center;gap:10px;padding:9px 14px;font-size:.82rem;background:rgba(245,158,11,.1);color:#fcd34d;border-bottom:1px solid rgba(245,158,11,.2)}.dm-banner.info{background:rgba(8,131,247,.1);color:#9ccbff;border-color:rgba(8,131,247,.2)}
.dm-thread{flex:1;overflow:auto;padding:6px 22px 28px}.dm-subj{font-size:1.32rem;font-weight:800;margin:14px 0 14px 50px;line-height:1.3;color:#fff;overflow-wrap:anywhere}
.dm-msg{border:1px solid var(--line);border-radius:16px;background:var(--panel2);margin-bottom:10px;overflow:hidden}
.dm-mh{display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer}.dm-av{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;flex:0 0 auto;font-size:.95rem}
.dm-mh .nm{font-weight:800;color:#fff}.dm-mh .em{color:var(--ink3);font-size:.8rem;font-weight:500;margin-left:6px}.dm-mh .to{color:var(--ink3);font-size:.79rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-mh .mid{flex:1;min-width:0}.dm-mh .dt{color:var(--ink3);font-size:.78rem;white-space:nowrap}
.dm-mb{padding:0 14px 14px 64px}.dm-frame{width:100%;border:0;border-radius:12px;background:#fff;display:block;min-height:60px}
.dm-plain{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0;color:var(--ink);line-height:1.6}
.dm-imgbar{display:flex;align-items:center;gap:8px;font-size:.78rem;color:var(--ink3);margin:0 0 8px}.dm-link{border:0;background:transparent;color:#5fb0ff;font-weight:700;padding:0}.dm-link:hover{text-decoration:underline}
.dm-atts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.dm-att{display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;max-width:260px;color:var(--ink)}
.dm-att:hover{border-color:rgba(8,131,247,.6)}.dm-att .an{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:.82rem}.dm-att .as{color:var(--ink3);font-size:.74rem}
.dm-rbtns{display:flex;gap:10px;margin:16px 0 0 50px;flex-wrap:wrap}.dm-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:transparent;border-radius:999px;padding:9px 20px;font-weight:700;color:var(--ink2)}
.dm-btn:hover{background:rgba(255,255,255,.06);color:#fff}.dm-btn.pri{border:0;color:#fff;background:linear-gradient(135deg,#0883F7,#0a6fd6);box-shadow:0 10px 22px -12px rgba(8,131,247,.8)}.dm-btn.pri:disabled{opacity:.55;cursor:default}
.dm-draftcard{display:flex;align-items:center;gap:10px;border:1px dashed rgba(252,83,5,.5);border-radius:14px;padding:12px 14px;margin-bottom:10px;color:var(--ink2);cursor:pointer}.dm-draftcard b{color:var(--orange)}
.dm-cw{position:fixed;right:26px;bottom:0;z-index:4000;width:min(580px,calc(100vw - 32px));display:flex;flex-direction:column;max-height:min(640px,calc(100vh - 40px));background:#0f1e33;border:1px solid rgba(255,255,255,.12);border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -10px 60px -10px rgba(0,0,0,.7);color:#eaf1fb;font-size:.92rem;animation:dmup .18s ease-out}
@keyframes dmup{from{transform:translateY(24px);opacity:0}}.dm-cw.full{inset:4vh 6vw;width:auto;max-height:none;border-radius:16px;border-bottom:1px solid rgba(255,255,255,.12)}.dm-cw.mini{max-height:46px;width:300px}.dm-cw.mini .dm-cbody{display:none}
.dm-ch{display:flex;align-items:center;gap:4px;padding:8px 8px 8px 16px;background:#10223B;border-radius:16px 16px 0 0;font-weight:800;cursor:pointer;flex:0 0 auto}.dm-ch .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-ch .dm-ib{width:30px;height:30px}
.dm-cbody{display:flex;flex-direction:column;min-height:0;flex:1}.dm-fl{display:flex;align-items:flex-start;gap:8px;padding:7px 16px;border-bottom:1px solid rgba(255,255,255,.07);color:#6f84a1;position:relative}
.dm-fl>label{padding-top:5px;font-size:.84rem;flex:0 0 auto}.dm-chips{flex:1;display:flex;flex-wrap:wrap;gap:5px;min-width:0}.dm-chips input,.dm-fl>input{flex:1;min-width:120px;border:0;outline:0;background:transparent;color:#eaf1fb;font:inherit;padding:5px 0}
.dm-chip{display:inline-flex;align-items:center;gap:5px;background:rgba(8,131,247,.16);border:1px solid rgba(8,131,247,.35);color:#d6e9ff;border-radius:999px;padding:2px 4px 2px 10px;font-size:.82rem;max-width:100%}.dm-chip.bad{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.5);color:#fecaca}
.dm-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-chip button{border:0;background:transparent;display:inline-flex;padding:2px;border-radius:50%;color:inherit}.dm-chip button:hover{background:rgba(255,255,255,.15)}
.dm-sug{position:absolute;left:50px;right:16px;top:100%;z-index:5;background:#13263f;border:1px solid rgba(255,255,255,.12);border-radius:12px;overflow:hidden;box-shadow:0 18px 40px -12px rgba(0,0,0,.7)}.dm-sug button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:9px 14px;color:#eaf1fb}.dm-sug button:hover,.dm-sug button.on{background:rgba(8,131,247,.2)}.dm-sug small{color:#6f84a1;margin-left:8px}
.dm-ed{flex:1;min-height:150px;overflow:auto;padding:14px 16px;outline:0;line-height:1.55;color:#eaf1fb;overflow-wrap:anywhere}.dm-ed:empty:before{content:attr(data-ph);color:#6f84a1}.dm-ed a{color:#5fb0ff}.dm-ed blockquote{border-left:3px solid rgba(255,255,255,.2);margin:6px 0;padding-left:12px;color:#9db0c9}
.dm-sig{margin:0 16px 8px;padding:10px 12px;border:1px dashed rgba(255,255,255,.14);border-radius:12px;font-size:.84rem;color:#9db0c9;max-height:110px;overflow:auto;position:relative}.dm-sig .lk{display:flex;align-items:center;gap:6px;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6f84a1;margin-bottom:4px}.dm-sig a{color:#5fb0ff}
.dm-q{margin:0 16px 8px}.dm-q .qb{max-height:130px;overflow:auto;border-left:3px solid rgba(255,255,255,.18);padding:4px 0 4px 12px;color:#6f84a1;font-size:.82rem;white-space:pre-wrap;margin-top:6px}
.dm-cf{display:flex;align-items:center;gap:6px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.07);flex:0 0 auto}.dm-cf .sv{margin-left:auto;font-size:.76rem;color:#6f84a1}
.dm-tb{display:flex;gap:0;margin-left:6px}.dm-tb .dm-ib{width:32px;height:32px}
.dm-toast{position:fixed;left:24px;bottom:24px;z-index:5000;display:flex;align-items:center;gap:14px;background:#1b2f4d;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 16px;box-shadow:0 18px 50px -12px rgba(0,0,0,.8);font-weight:600;animation:dmup .18s ease-out}.dm-toast button{border:0;background:transparent;color:#5fb0ff;font-weight:800}
.dm-off{grid-column:1/-1}
@media(max-width:860px){.dm{grid-template-columns:1fr;gap:10px;min-height:0}.dm-rail{flex-direction:row;overflow-x:auto;padding:2px 0 6px;scrollbar-width:none}.dm-rail::-webkit-scrollbar{display:none}.dm-f{flex:0 0 auto;border:1px solid var(--line);padding:8px 14px;gap:8px}.dm-f .n{margin-left:4px}
 .dm-compose{position:fixed;right:18px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:3000;margin:0;border-radius:18px;padding:15px 20px}.dm-who{display:none}
 .dm-row{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"star who meta" "star txt txt";padding:9px 12px 9px 4px;row-gap:2px}.dm-row .dm-chk{display:none}.dm-row .dm-starb{grid-area:star}.dm-row .who{grid-area:who}.dm-row .txt{grid-area:txt}.dm-row .meta{grid-area:meta}.dm-row:hover .acts{display:none}.dm-row:hover .meta .d{display:inline}
 .dm-thread{padding:4px 10px 90px}.dm-subj{margin-left:4px;font-size:1.12rem}.dm-mb{padding:0 12px 12px}.dm-rbtns{margin-left:0}.dm-mh .em{display:none}
 .dm-cw,.dm-cw.full{inset:0;width:auto;max-height:none;border-radius:0;border:0}.dm-cw.mini{inset:auto 0 0 0;width:auto}.dm-ch{border-radius:0}.dm-toast{left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom))}}
/* ---- premium pass (bl_dmail_0357): app-like panel, date groups, glass bars, mobile = native-mail feel ---- */
.dm-main{height:calc(100vh - 190px);min-height:540px;background:linear-gradient(180deg,#11223b,#0d1b30);box-shadow:0 24px 60px -30px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.04)}
.dm-top{position:sticky;top:0;z-index:3;backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px)}
.dm-list,.dm-thread{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}.dm-list::-webkit-scrollbar,.dm-thread::-webkit-scrollbar{width:8px}.dm-list::-webkit-scrollbar-thumb,.dm-thread::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:8px}
.dm-grp{padding:14px 18px 6px;font-size:.7rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink3)}
.dm-row{animation:dmfade .22s ease-out both}@keyframes dmfade{from{opacity:0;transform:translateY(3px)}}
.dm-row.un{box-shadow:inset 3px 0 0 var(--orange)}.dm-row.un:hover{box-shadow:inset 3px 0 0 var(--orange)}
.dm-rav{display:none}.dm-msg{box-shadow:0 10px 30px -18px rgba(0,0,0,.6)}.dm-ch .mob-send{display:none}
.dm-ib:active,.dm-btn:active,.dm-f:active,.dm-compose:active{transform:scale(.96)}
.dm-who{background:linear-gradient(160deg,rgba(8,131,247,.12),rgba(255,255,255,.02))}
@media(max-width:860px){
 .dm-main{height:auto;min-height:60vh;border-radius:20px}.dm.reading .dm-rail,.dm.reading .dm-top{display:none}
 .dm-rail{position:sticky;top:0;z-index:4;background:linear-gradient(180deg,#0b1626 70%,transparent);margin:0 -2px;padding:4px 2px 10px}
 .dm-f{min-height:40px;background:rgba(255,255,255,.04)}.dm-f.on{background:linear-gradient(135deg,#0883F7,#0a6fd6);border-color:transparent;box-shadow:0 8px 18px -10px rgba(8,131,247,.8)}
 .dm-search{padding:11px 16px}.dm-bar{min-height:42px}.dm-bar .dm-chk{display:none}.dm-grp{padding:14px 14px 4px}
 .dm-row{grid-template-columns:44px minmax(0,1fr) auto;grid-template-areas:"av who meta" "av txt star";padding:11px 12px;min-height:68px;column-gap:10px;row-gap:3px;font-size:.93rem}
 .dm-rav{display:flex;grid-area:av;width:42px;height:42px;border-radius:50%;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1rem;align-self:center}
 .dm-row .dm-starb{grid-area:star;justify-self:end;padding:2px}.dm-row .txt{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.35}
 .dm-row .txt .sub{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dm-row .txt .sn{font-size:.85rem}
 .dm-thread{padding:4px 8px 16px}.dm-msg{border-radius:18px}.dm-mh{padding:12px}.dm-mh .dm-ib{display:none}.dm-frame{border-radius:14px}
 .dm-rbtns{position:sticky;bottom:0;margin:12px -8px -16px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(11,22,38,.86);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);flex-wrap:nowrap;z-index:2}
 .dm-rbtns .dm-btn{flex:1;justify-content:center;padding:12px 8px;border-radius:14px;background:rgba(255,255,255,.05)}
 .dm-cw,.dm-cw.full{padding-top:env(safe-area-inset-top)}.dm-ch{padding:10px 8px 10px 16px;cursor:default}.dm-ch .desk{display:none}.dm-ch .mob-send{display:inline-flex;width:40px;height:40px;color:#fff;background:linear-gradient(135deg,#0883F7,#0a6fd6);margin-right:4px}.dm-ch .dm-ib{width:40px;height:40px}
 .dm-ed{font-size:1rem;min-height:34vh}.dm-cf{padding-bottom:calc(10px + env(safe-area-inset-bottom))}.dm-cf .dm-btn.pri{display:none}.dm-tb .dm-ib{width:38px;height:38px}
 .dm-fl input,.dm-chips input{font-size:16px}.dm-search input{font-size:16px}
}
@media(prefers-reduced-motion:reduce){.dm-row{animation:none}.dm-cw,.dm-toast,.dm-sk,.dm-ib.spin .dm-ic{animation:none}}
`;
  function injectCss() {
    if (document.getElementById("dm-css")) return;
    const s = document.createElement("style");
    s.id = "dm-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var AVC = ["#0883F7", "#FC5305", "#7c3aed", "#059669", "#db2777", "#0891b2", "#ca8a04", "#4f46e5"];
  var avColor = (s) => {
    let n = 0;
    for (const c of String(s || "?")) n = n * 31 + c.charCodeAt(0) >>> 0;
    return AVC[n % AVC.length];
  };
  var nameOf = (m) => (m.from_name || "").trim() || (m.from_email || "").split("@")[0] || "Unknown";
  var fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " KB";
  function fmtDate(iso, long) {
    const d = new Date(iso), now2 = /* @__PURE__ */ new Date();
    if (isNaN(+d)) return "";
    const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (long) return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === now2.getFullYear() ? void 0 : "numeric" }) + ", " + t;
    if (d.toDateString() === now2.toDateString()) return t;
    return d.toLocaleDateString([], d.getFullYear() === now2.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "2-digit" });
  }
  function agoShort(iso) {
    if (!iso) return "never";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1e3);
    return s < 50 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
  }
  function groupOf(iso) {
    const d = new Date(iso), n = /* @__PURE__ */ new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(n) - day(d)) / 864e5);
    return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? "This week" : diff < 31 ? "This month" : "Older";
  }
  var escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var OK_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, P: 1, DIV: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, A: 1, SPAN: 1 };
  function cleanHtml(root) {
    const out = [];
    (function walk(n) {
      n.childNodes.forEach((c) => {
        if (c.nodeType === 3) {
          out.push(escHtml(c.nodeValue));
          return;
        }
        if (c.nodeType !== 1) return;
        const t = c.tagName;
        if (t === "SCRIPT" || t === "STYLE") return;
        if (!OK_TAGS[t]) {
          walk(c);
          return;
        }
        if (t === "BR") {
          out.push("<br>");
          return;
        }
        let attrs = "";
        if (t === "A") {
          const u = c.getAttribute("href") || "";
          if (/^(https?:|mailto:|tel:)/i.test(u)) attrs = ' href="' + escHtml(u) + '" target="_blank" rel="noopener"';
        }
        const tag = t.toLowerCase();
        out.push("<" + tag + attrs + ">");
        walk(c);
        out.push("</" + tag + ">");
      });
    })(root);
    return out.join("");
  }
  var stripHostile = (html) => String(html || "").replace(/<(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\/\1>|\/?>)/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  var hasRemote = (html) => /<img[^>]+src\s*=\s*["']?https?:/i.test(html || "") || /url\(\s*["']?https?:/i.test(html || "");
  var FOLDERS = [["inbox", "Inbox", "inbox"], ["starred", "Starred", "star"], ["sent", "Sent", "send"], ["drafts", "Drafts", "draft"], ["spam", "Spam", "spam"], ["trash", "Trash", "trash"]];
  var EMPTY = { inbox: ["Inbox zero", "New email lands here within a minute of arriving."], starred: ["No starred email", "Star the threads you need to come back to."], sent: ["Nothing sent yet", "Email you send shows up here."], drafts: ["No drafts", "Anything you start writing is saved here automatically."], spam: ["No spam", "Good."], trash: ["Trash is empty", "Deleted email stays here until it is deleted forever."] };
  function mountDispatcherMail(host, opts) {
    opts = opts || {};
    let api2 = opts.api || null;
    injectCss();
    const S = { acc: null, staff: false, folder: "inbox", q: "", rows: [], more: false, loading: true, sel: /* @__PURE__ */ new Set(), counts: {}, open: null, msgs: [], lastSync: null, problem: false, latest: null, dead: false, syncing: false };
    let root = el("div", { class: "dm" });
    mount(host, root);
    let pollT = null, syncT = null, toastEl = null, toastT = null;
    const composers = [];
    function toast(msg, action, onAction, ms) {
      if (toastEl) toastEl.remove();
      clearTimeout(toastT);
      toastEl = el("div", { class: "dm-toast", role: "status" }, [msg, action ? el("button", { onClick: () => {
        toastEl && toastEl.remove();
        onAction && onAction();
      } }, action) : null]);
      document.body.appendChild(toastEl);
      toastT = setTimeout(() => toastEl && toastEl.remove(), ms || 4e3);
    }
    const fail2 = (e) => toast(e && e.message || "Something went wrong");
    const btn = (icn, label, fn, extra) => el("button", Object.assign({ class: "dm-ib", title: label, "aria-label": label, onClick: (ev) => {
      ev.stopPropagation();
      fn(ev);
    } }, extra || {}), ic(icn, 18));
    async function boot() {
      try {
        if (!api2) api2 = await Promise.resolve().then(() => (init_api(), api_exports));
        const b = await api2.dmailBootstrap(opts.accountId || null);
        if (S.dead) return;
        if (!b || !b.enabled) return renderOff(b && b.reason);
        S.acc = b.account;
        S.staff = !!b.staff_view;
        S.canDel = !!b.can_delete;
        if (opts.open && opts.open.folder && opts.open.folder !== "drafts") S.folder = opts.open.folder;
        S.counts = b.counts || {};
        S.lastSync = b.account.last_sync_at;
        S.problem = !!b.account.sync_problem;
        paint();
        await loadList();
        syncNow(true);
        if (opts.open && opts.open.thread) openRow({ thread: opts.open.thread, subject: opts.open.subject || "", ids: [], id: null, folder: S.folder });
        pollT = setInterval(poll, 2e4);
        syncT = setInterval(() => {
          if (!document.hidden) syncNow(true);
        }, 45e3);
        document.addEventListener("keydown", onKey);
      } catch (e) {
        renderOff("error", e);
      }
    }
    function renderOff(reason, e) {
      const M2 = { no_mailbox: ["No mailbox assigned yet", "LoadBoot will assign you a company email address. It appears here the moment it is assigned \u2014 nothing to set up on your side."], paused: ["Mailbox paused", "LoadBoot staff have paused this mailbox. Message your coordinator if you need it back."], not_active: ["Mailbox not available", "Your dispatcher account is not active right now."], error: ["Could not load your mailbox", e && e.message || "Try again in a moment."] }[reason] || ["Mailbox not available", ""];
      mount(root, el("div", { class: "dm-main dm-off" }, el("div", { class: "dm-empty" }, [el("div", { class: "big" }, ic("mail", 30)), el("b", null, M2[0]), el("div", null, M2[1])])));
      try {
        opts.onUnread && opts.onUnread(0);
      } catch (_) {
      }
    }
    async function loadList(append) {
      if (!append) {
        S.loading = true;
        S.sel.clear();
        paintMain();
      }
      try {
        const before = append && S.rows.length ? S.rows[S.rows.length - 1].date : null;
        const r = await api2.dmailList({ account: S.acc.id, folder: S.folder, q: S.q, before, limit: 40 });
        if (S.dead) return;
        if (r && r.error) throw new Error(r.error);
        const rows = r.rows || [];
        S.rows = append ? S.rows.concat(rows) : rows;
        S.more = rows.length === 40;
        setCounts(r.counts);
        S.lastSync = r.last_sync_at || S.lastSync;
      } catch (e) {
        fail2(e);
      }
      S.loading = false;
      paintRail();
      if (!S.open) paintMain();
    }
    function setCounts(c) {
      if (!c) return;
      const prev = S.counts.inbox || 0;
      S.counts = c;
      try {
        opts.onUnread && opts.onUnread(c.inbox || 0);
      } catch (_) {
      }
      return (c.inbox || 0) > prev;
    }
    async function poll() {
      if (S.dead || document.hidden || !S.acc) return;
      try {
        const p = await api2.dmailPoll(S.acc.id);
        if (!p || p.error) return;
        const grew = setCounts(p.counts);
        S.lastSync = p.last_sync_at;
        S.problem = !!p.sync_problem;
        if (p.latest && p.latest !== S.latest) {
          const first = S.latest === null;
          S.latest = p.latest;
          if (!first) {
            if (grew) toast("New email");
            if (!S.open && !S.sel.size) await quietReload();
          }
        }
        paintRail();
      } catch (_) {
      }
    }
    async function quietReload() {
      try {
        const r = await api2.dmailList({ account: S.acc.id, folder: S.folder, q: S.q, limit: Math.max(40, S.rows.length) });
        if (r && r.rows) {
          S.rows = r.rows;
          setCounts(r.counts);
          if (!S.open) paintMain();
          paintRail();
        }
      } catch (_) {
      }
    }
    async function syncNow(quiet) {
      if (S.syncing || !S.acc) return;
      S.syncing = true;
      if (!quiet) paintMain();
      try {
        const r = await api2.dmailAct({ action: "sync", account: S.acc.id });
        S.problem = !(r && r.ok);
        if (r && r.ok) S.lastSync = (/* @__PURE__ */ new Date()).toISOString();
        if (!quiet || r && r.added) await quietReload();
        if (!quiet && r && !r.ok) toast("Mail server: " + (r.error || "not reachable"));
      } catch (e) {
        if (!quiet) fail2(e);
      }
      S.syncing = false;
      if (!quiet) paintMain();
      paintRail();
    }
    async function act(body, local) {
      try {
        local && local();
        await api2.dmailAct(Object.assign({ account: S.acc.id }, body));
        poll();
      } catch (e) {
        fail2(e);
        await quietReload();
      }
    }
    const idsOf = (rows) => rows.reduce((a, r) => a.concat(r.ids || [r.id]), []);
    const selectedRows = () => S.rows.filter((r) => S.sel.has(r.thread));
    function moveRows(rows, to, verb) {
      const ids = idsOf(rows), keys = new Set(rows.map((r) => r.thread));
      act({ action: "move", ids, to }, () => {
        S.rows = S.rows.filter((r) => !keys.has(r.thread));
        S.sel.clear();
        S.open = null;
        paintMain();
        toast(verb);
      });
    }
    function deleteForever(rows) {
      const ids = idsOf(rows), keys = new Set(rows.map((r) => r.thread));
      act({ action: "delete", ids }, () => {
        S.rows = S.rows.filter((r) => !keys.has(r.thread));
        S.sel.clear();
        S.open = null;
        paintMain();
        toast("Deleted forever");
      });
    }
    function markRows(rows, seen) {
      act({ action: "mark", ids: idsOf(rows), seen }, () => {
        rows.forEach((r) => {
          r.unread = !seen;
        });
        S.sel.clear();
        if (!S.open) paintMain();
      });
    }
    function starRow(r) {
      const on = !r.starred;
      act({ action: "mark", ids: [r.id], starred: on }, () => {
        r.starred = on;
        if (!S.open) paintMain();
      });
    }
    async function discardDrafts(rows) {
      try {
        for (const r of rows) await api2.dmailDraftDiscard(r.id);
        toast("Draft discarded");
      } catch (e) {
        fail2(e);
      }
      await loadList();
    }
    let railEl, mainEl;
    function paint() {
      railEl = el("nav", { class: "dm-rail", "aria-label": "Mail folders" });
      mainEl = el("section", { class: "dm-main" });
      mount(root, [railEl, mainEl]);
      paintRail();
      paintMain();
    }
    function paintRail() {
      if (!railEl) return;
      mount(railEl, [
        el("button", { class: "dm-compose", onClick: () => compose({}) }, [ic("pen", 18), "Compose"]),
        ...FOLDERS.filter(([id]) => id !== "trash" || S.canDel).map(([id, label, icn]) => {
          const n = id === "inbox" ? S.counts.inbox : id === "drafts" ? S.counts.drafts : id === "spam" ? S.counts.spam : 0;
          return el("button", { class: "dm-f" + (S.folder === id && !S.q ? " on" : ""), onClick: () => {
            S.folder = id;
            S.q = "";
            S.open = null;
            loadList();
          } }, [ic(icn, 18), label, n ? el("span", { class: "n" }, String(n)) : null]);
        }),
        el("div", { class: "dm-who" }, [el("b", { title: S.acc.address }, S.acc.address), S.acc.display_name, el("div", { class: "s" }, [el("span", { class: "dm-dot" + (S.problem ? " bad" : "") }), S.problem ? "Reconnecting\u2026" : "Synced " + agoShort(S.lastSync)])])
      ]);
    }
    function paintMain() {
      if (!mainEl) return;
      root.classList.toggle("reading", !!S.open);
      if (S.open) return paintThread();
      paintList();
    }
    function topBar() {
      let t = null;
      const inp = el("input", { type: "search", placeholder: "Search mail", value: S.q, "aria-label": "Search mail", onInput: () => {
        clearTimeout(t);
        t = setTimeout(() => {
          S.q = inp.value.trim();
          S.open = null;
          loadList();
        }, 350);
      } });
      return el("div", { class: "dm-top" }, [el("label", { class: "dm-search" }, [ic("search", 17), inp]), btn("refresh", "Check for new mail", () => syncNow(false), { class: "dm-ib" + (S.syncing ? " spin" : ""), disabled: S.syncing })]);
    }
    function banners() {
      return [
        S.staff ? el("div", { class: "dm-banner info" }, [ic("lock", 15), "Staff view of " + S.acc.address + (S.acc.assigned_name ? " \xB7 assigned to " + S.acc.assigned_name : " \xB7 not assigned") + " \u2014 anything you do here happens in the dispatcher's real mailbox."]) : null,
        S.problem ? el("div", { class: "dm-banner" }, [ic("alert", 15), "The mail server is not answering right now. Your email is safe \u2014 this reconnects on its own. LoadBoot staff can see the problem."]) : null
      ];
    }
    function paintList() {
      const sel = selectedRows(), f = S.folder, all = S.rows.length && sel.length === S.rows.length;
      const bar = el("div", { class: "dm-bar" }, [
        el("input", { type: "checkbox", class: "dm-chk", "aria-label": "Select all", checked: all || null, onChange: (e) => {
          S.sel = new Set(e.target.checked ? S.rows.map((r) => r.thread) : []);
          paintList();
        } }),
        ...sel.length ? [
          f === "drafts" ? btn("trash", "Discard drafts", () => discardDrafts(sel)) : null,
          f === "trash" || f === "spam" ? btn("restore", f === "spam" ? "Not spam" : "Move to inbox", () => moveRows(sel, "inbox", f === "spam" ? "Moved to inbox" : "Restored")) : null,
          S.canDel && (f === "trash" || f === "spam") ? btn("trash", "Delete forever", () => deleteForever(sel)) : null,
          S.canDel && f !== "trash" && f !== "spam" && f !== "drafts" ? btn("trash", "Delete", () => moveRows(sel, "trash", "Moved to Trash")) : null,
          f === "inbox" ? btn("spam", "Report spam", () => moveRows(sel, "spam", "Marked as spam")) : null,
          f !== "drafts" ? btn("mailopen", "Mark as read", () => markRows(sel, true)) : null,
          f !== "drafts" ? btn("mail", "Mark as unread", () => markRows(sel, false)) : null,
          el("span", null, sel.length + " selected")
        ] : [el("span", null, S.q ? "Search results" : (FOLDERS.find((x) => x[0] === f) || [])[1])],
        el("span", { class: "sp" }),
        el("span", null, S.rows.length ? S.rows.length + (S.more ? "+" : "") + " conversation" + (S.rows.length === 1 ? "" : "s") : "")
      ]);
      const list = el("div", { class: "dm-list", role: "list" });
      if (S.loading) for (let i = 0; i < 9; i++) list.appendChild(el("div", { class: "dm-sk" }));
      else if (!S.rows.length) {
        const E = S.q ? ["No results", "Nothing matches \u201C" + S.q + "\u201D."] : EMPTY[f];
        list.appendChild(el("div", { class: "dm-empty" }, [el("div", { class: "big" }, ic(S.q ? "search" : (FOLDERS.find((x) => x[0] === f) || [])[2], 30)), el("b", null, E[0]), el("div", null, E[1])]));
      } else {
        let g0 = null;
        S.rows.forEach((r) => {
          const g = S.q ? null : groupOf(r.date);
          if (g && g !== g0) {
            g0 = g;
            list.appendChild(el("div", { class: "dm-grp" }, g));
          }
          list.appendChild(rowEl(r));
        });
        if (S.more) list.appendChild(el("button", { class: "dm-more", onClick: () => loadList(true) }, "Load older"));
      }
      mount(mainEl, [topBar(), ...banners(), bar, list]);
    }
    function rowEl(r) {
      const f = r.folder, isDraft = f === "drafts", outgoing = f === "sent" || isDraft;
      const toNames = (r.to || []).map((t) => t.name || t.email).join(", ");
      const who = isDraft ? [el("span", { class: "dr" }, "Draft"), toNames ? " " + toNames : ""] : outgoing ? "To: " + (toNames || "(no recipient)") : (r.names && r.names.length ? r.names : [nameOf(r)]).map((n) => n === S.acc.address || n === S.acc.display_name ? "me" : n).slice(-3).join(", ");
      return el("div", { class: "dm-row" + (r.unread ? " un" : "") + (S.sel.has(r.thread) ? " sel" : ""), role: "listitem", tabindex: "0", onClick: () => openRow(r), onKeydown: (e) => {
        if (e.key === "Enter") openRow(r);
      } }, [
        el("input", { type: "checkbox", class: "dm-chk", "aria-label": "Select conversation", checked: S.sel.has(r.thread) || null, onClick: (e) => e.stopPropagation(), onChange: (e) => {
          e.target.checked ? S.sel.add(r.thread) : S.sel.delete(r.thread);
          paintList();
        } }),
        isDraft ? el("span", { style: "width:30px" }) : el("button", { class: "dm-starb" + (r.starred ? " on" : ""), "aria-label": r.starred ? "Remove star" : "Add star", onClick: (e) => {
          e.stopPropagation();
          starRow(r);
        } }, ic("star", 17, r.starred ? "currentColor" : "none")),
        el("div", { class: "dm-rav", style: "background:" + avColor(outgoing ? ((r.to || [])[0] || {}).email : r.from_email) }, ((outgoing ? toNames || "?" : nameOf(r))[0] || "?").toUpperCase()),
        el("div", { class: "who" }, [who, r.total > 1 ? el("i", null, String(r.total)) : null]),
        el("div", { class: "txt" }, [el("span", { class: "sub" }, r.subject || "(no subject)"), el("span", { class: "sn" }, r.snippet ? " \u2014 " + r.snippet : "")]),
        el("div", { class: "meta" }, [
          r.has_attach ? ic("clip", 15) : null,
          el("span", { class: "d" }, fmtDate(r.date)),
          el("span", { class: "acts" }, isDraft ? [btn("trash", "Discard draft", () => discardDrafts([r]))] : f === "trash" || f === "spam" ? [btn("restore", "Move to inbox", () => moveRows([r], "inbox", "Moved to inbox")), S.canDel ? btn("trash", "Delete forever", () => deleteForever([r])) : null] : [S.canDel ? btn("trash", "Delete", () => moveRows([r], "trash", "Moved to Trash")) : null, btn(r.unread ? "mailopen" : "mail", r.unread ? "Mark as read" : "Mark as unread", () => markRows([r], !!r.unread))])
        ])
      ]);
    }
    async function openRow(r) {
      if (r.folder === "drafts" && (r.total || 1) <= 1) return openDraft(r.id, r.thread);
      S.open = r;
      S.msgs = null;
      paintThread();
      try {
        const t = await api2.dmailThread(S.acc.id, r.thread, S.folder === "trash" || S.folder === "spam" ? S.folder : null);
        if (S.open !== r) return;
        if (t && t.error) throw new Error(t.error);
        S.msgs = t.messages || [];
        if (!r.ids || !r.ids.length) {
          r.ids = S.msgs.map((m) => m.id);
          r.id = r.id || (S.msgs[S.msgs.length - 1] || {}).id;
          r.subject = r.subject || (S.msgs[0] || {}).subject;
        }
        paintThread();
        const unseen = S.msgs.filter((m) => !m.seen && m.folder !== "drafts").map((m) => m.id);
        if (unseen.length) act({ action: "mark", ids: unseen, seen: true }, () => {
          r.unread = false;
        });
      } catch (e) {
        fail2(e);
        S.open = null;
        paintMain();
      }
    }
    async function openDraft(id, thread) {
      try {
        const t = await api2.dmailThread(S.acc.id, thread, null);
        const d = (t.messages || []).find((m) => m.id === id);
        if (d) compose({ draft: d });
      } catch (e) {
        fail2(e);
      }
    }
    function paintThread() {
      root.classList.add("reading");
      const r = S.open, f = S.folder, inBin = f === "trash" || f === "spam";
      const bar = el("div", { class: "dm-bar" }, [
        btn("back", "Back to list", closeThread),
        inBin ? btn("restore", "Move to inbox", () => moveRows([r], "inbox", "Moved to inbox")) : S.canDel ? btn("trash", "Delete", () => moveRows([r], "trash", "Moved to Trash")) : null,
        inBin ? S.canDel ? btn("trash", "Delete forever", () => deleteForever([r])) : null : btn("spam", "Report spam", () => moveRows([r], "spam", "Marked as spam")),
        btn("mail", "Mark as unread", () => {
          markRows([r], false);
          closeThread();
        })
      ]);
      const body = el("div", { class: "dm-thread" });
      if (!S.msgs) for (let i = 0; i < 3; i++) body.appendChild(el("div", { class: "dm-sk", style: "border-radius:14px;margin:10px 0;height:64px" }));
      else {
        body.appendChild(el("h2", { class: "dm-subj" }, r.subject || "(no subject)"));
        const real = S.msgs.filter((m) => m.folder !== "drafts"), drafts = S.msgs.filter((m) => m.folder === "drafts");
        real.forEach((m, i) => body.appendChild(msgEl(m, i === real.length - 1)));
        drafts.forEach((d) => body.appendChild(el("div", { class: "dm-draftcard", onClick: () => compose({ draft: d }) }, [ic("pen", 16), el("b", null, "Draft"), d.snippet || "(empty)", el("span", { style: "margin-left:auto" }, "Continue writing")])));
        const last = real[real.length - 1];
        if (last && !inBin) body.appendChild(el("div", { class: "dm-rbtns" }, [
          el("button", { class: "dm-btn", onClick: () => compose({ reply: last, mode: "reply" }) }, [ic("reply", 16), "Reply"]),
          (last.to || []).length + (last.cc || []).length > 1 ? el("button", { class: "dm-btn", onClick: () => compose({ reply: last, mode: "replyall" }) }, [ic("replyall", 16), "Reply all"]) : null,
          el("button", { class: "dm-btn", onClick: () => compose({ reply: last, mode: "forward" }) }, [ic("forward", 16), "Forward"])
        ]));
      }
      mount(mainEl, [topBar(), ...banners(), bar, body]);
    }
    function closeThread() {
      S.open = null;
      paintMain();
    }
    function msgEl(m, expanded) {
      const mine = (m.from_email || "") === S.acc.address;
      const nm = mine ? "me" : nameOf(m);
      const toLine = "to " + ((m.to || []).concat(m.cc || []).map((t) => t.email === S.acc.address ? "me" : t.name || t.email).join(", ") || "\u2014") + ((m.bcc || []).length ? ", bcc: " + m.bcc.map((t) => t.name || t.email).join(", ") : "");
      const wrap = el("article", { class: "dm-msg" });
      let open = expanded;
      const bodyHost = el("div", { class: "dm-mb" });
      const head = el("div", { class: "dm-mh", onClick: () => {
        open = !open;
        draw();
      } });
      function draw() {
        mount(head, [
          el("div", { class: "dm-av", style: "background:" + avColor(m.from_email) }, (nm[0] || "?").toUpperCase()),
          el("div", { class: "mid" }, [el("div", null, [el("span", { class: "nm" }, nm), mine ? null : el("span", { class: "em" }, "<" + (m.from_email || "") + ">")]), el("div", { class: "to" }, open ? toLine : m.snippet || "")]),
          m.attachments && m.attachments.length && !open ? ic("clip", 15) : null,
          el("span", { class: "dt" }, fmtDate(m.date, open)),
          open ? btn("reply", "Reply", () => compose({ reply: m, mode: "reply" })) : null,
          open ? btn("forward", "Forward", () => compose({ reply: m, mode: "forward" })) : null
        ]);
        if (!open) {
          clear(bodyHost);
          bodyHost.style.display = "none";
          return;
        }
        bodyHost.style.display = "";
        if (!bodyHost.firstChild) fillBody(bodyHost, m);
      }
      wrap.appendChild(head);
      wrap.appendChild(bodyHost);
      draw();
      return wrap;
    }
    function fillBody(hostEl, m) {
      const parts = [];
      if (m.html) {
        const safe = stripHostile(m.html);
        let remote = false;
        const frame = el("iframe", { class: "dm-frame", sandbox: "allow-same-origin allow-popups allow-popups-to-escape-sandbox", referrerpolicy: "no-referrer", title: "Email content" });
        const fit = () => {
          try {
            const d = frame.contentDocument;
            if (d && d.documentElement) frame.style.height = Math.min(Math.max(d.documentElement.scrollHeight, 60), 6e3) + "px";
          } catch (_) {
          }
        };
        const setDoc = () => {
          frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:` + (remote ? " https: http:" : "") + '; font-src data:"><base target="_blank"><style>html,body{margin:0}body{padding:16px;font:14px/1.55 Arial,Helvetica,sans-serif;color:#1f2937;overflow-wrap:anywhere;background:#fff}img{max-width:100%;height:auto}table{max-width:100%}blockquote{border-left:3px solid #d1d5db;margin:8px 0;padding-left:12px;color:#6b7280}a{color:#0a6fd6}</style></head><body>' + safe + "</body></html>";
        };
        frame.addEventListener("load", () => {
          fit();
          setTimeout(fit, 400);
          setTimeout(fit, 1500);
        });
        if (hasRemote(safe)) {
          const barEl = el("div", { class: "dm-imgbar" }, [ic("img", 14), "Images are hidden to protect your privacy.", el("button", { class: "dm-link", onClick: () => {
            remote = true;
            setDoc();
            barEl.remove();
          } }, "Show images")]);
          parts.push(barEl);
        }
        setDoc();
        parts.push(frame);
      } else parts.push(el("pre", { class: "dm-plain" }, m.text || "(empty message)"));
      const atts = (m.attachments || []).filter((a) => !a.inline || !m.html);
      if (atts.length) parts.push(el("div", { class: "dm-atts" }, atts.map((a) => el("button", { class: "dm-att", title: "Download " + a.name, onClick: (e) => download(m, a, e.currentTarget) }, [ic(/^image\//.test(a.type) ? "img" : "draft", 20), el("div", { style: "min-width:0;text-align:left" }, [el("div", { class: "an" }, a.name), el("div", { class: "as" }, fmtSize(a.size))]), ic("download", 16)]))));
      mount(hostEl, parts);
    }
    async function download(m, a, el2) {
      el2.disabled = true;
      el2.style.opacity = ".6";
      try {
        const data = await api2.dmailAct({ action: "attachment", account: S.acc.id, id: m.id, idx: a.idx });
        if (!(data instanceof Blob)) throw new Error("Could not download that file");
        const url = URL.createObjectURL(new Blob([data], { type: a.type || "application/octet-stream" }));
        const link = el("a", { href: url, download: a.name });
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3e4);
      } catch (e) {
        fail2(e);
      }
      el2.disabled = false;
      el2.style.opacity = "";
    }
    function compose(o) {
      if (composers.length >= 2) {
        toast("Finish or close a draft first");
        return;
      }
      const d = o.draft || null, src = o.reply || null, mode = d ? d.draft_meta && d.draft_meta.mode || "new" : o.mode || "new";
      const C = { id: d ? d.id : null, to: [], cc: [], bcc: [], files: [], replyTo: null, forwardOf: null, quoteHtml: "", quoteText: "", dirty: false, saving: null, closed: false };
      const me2 = S.acc.address, uniq = (l) => {
        const seen = /* @__PURE__ */ new Set();
        return l.filter((x) => x.email && x.email !== me2 && !seen.has(x.email) && seen.add(x.email));
      };
      let subject = d ? d.subject || "" : "";
      if (d) {
        C.to = (d.to || []).slice();
        C.cc = (d.cc || []).slice();
        C.bcc = (d.bcc || []).slice();
        if (d.draft_meta && d.draft_meta.reply_to) {
          if (mode === "forward") C.forwardOf = d.draft_meta.reply_to;
          else C.replyTo = d.draft_meta.reply_to;
        }
      }
      const quoteFrom = src || (d && S.msgs ? S.msgs.find((x) => x.id === (d.draft_meta || {}).reply_to) : null);
      if (src) {
        const base = (src.subject || "").replace(/^\s*((re|fwd?|fw):\s*)+/i, "");
        if (mode === "forward") {
          subject = "Fwd: " + base;
          C.forwardOf = src.id;
        } else {
          subject = "Re: " + base;
          C.replyTo = src.id;
          const mineMsg = src.from_email === me2;
          C.to = uniq(mineMsg ? src.to || [] : [{ email: src.from_email, name: src.from_name || "" }]);
          if (mode === "replyall") C.cc = uniq((src.to || []).concat(src.cc || [])).filter((x) => !C.to.some((t) => t.email === x.email));
        }
      }
      if (quoteFrom) {
        const hdr = mode === "forward" ? "---------- Forwarded message ----------<br>From: " + escHtml(nameOf(quoteFrom)) + " &lt;" + escHtml(quoteFrom.from_email) + "&gt;<br>Date: " + escHtml(fmtDate(quoteFrom.date, true)) + "<br>Subject: " + escHtml(quoteFrom.subject || "") + "<br>To: " + escHtml((quoteFrom.to || []).map((t) => t.email).join(", ")) + "<br><br>" : "On " + escHtml(fmtDate(quoteFrom.date, true)) + ", " + escHtml(nameOf(quoteFrom)) + " &lt;" + escHtml(quoteFrom.from_email) + "&gt; wrote:<br>";
        const qt = (quoteFrom.text || "").slice(0, 2e4);
        C.quoteText = qt;
        C.quoteHtml = '<div style="color:#6b7280">' + hdr + '</div><blockquote style="border-left:3px solid #d1d5db;margin:6px 0 0;padding-left:12px;color:#6b7280">' + escHtml(qt).replace(/\n/g, "<br>") + "</blockquote>";
      }
      const win = el("div", { class: "dm-cw", role: "dialog", "aria-label": "New message" });
      const title = el("span", { class: "t" }, subject || "New message"), saved = el("span", { class: "sv" });
      const subj = el("input", { type: "text", placeholder: "Subject", value: subject, "aria-label": "Subject", onInput: () => {
        title.textContent = subj.value || "New message";
        touch();
      } });
      const ed = el("div", { class: "dm-ed", contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Message", "data-ph": "Write your message\u2026", onInput: touch });
      if (d && d.html) {
        const tmp = document.createElement("template");
        tmp.innerHTML = d.html;
        ed.innerHTML = cleanHtml(tmp.content);
      }
      ed.addEventListener("paste", (e) => {
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData).getData("text/plain");
        document.execCommand("insertText", false, t);
      });
      const exec = (cmd, val) => {
        ed.focus();
        document.execCommand(cmd, false, val);
        touch();
      };
      const tbtn = (icn, label, fn) => el("button", { class: "dm-ib", type: "button", title: label, "aria-label": label, onMousedown: (e) => e.preventDefault(), onClick: fn }, ic(icn, 16));
      const fileInp = el("input", { type: "file", multiple: true, style: "display:none", onChange: () => {
        addFiles(fileInp.files);
        fileInp.value = "";
      } });
      const attHost = el("div", { class: "dm-atts", style: "margin:0 16px 8px" });
      function addFiles(list) {
        for (const f of list) {
          const total = C.files.reduce((s, x) => s + x.size, 0) + f.size;
          if (total > 15 * 1048576) {
            toast("Attachments are limited to 15 MB per email");
            break;
          }
          C.files.push(f);
        }
        drawAtts();
      }
      function drawAtts() {
        mount(attHost, C.files.map((f, i) => el("div", { class: "dm-att" }, [ic("clip", 16), el("div", { style: "min-width:0" }, [el("div", { class: "an" }, f.name), el("div", { class: "as" }, fmtSize(f.size))]), el("button", { class: "dm-ib", style: "width:26px;height:26px", "aria-label": "Remove " + f.name, onClick: () => {
          C.files.splice(i, 1);
          drawAtts();
        } }, ic("x", 14))])));
        attHost.style.display = C.files.length ? "" : "none";
      }
      win.addEventListener("dragover", (e) => e.preventDefault());
      win.addEventListener("drop", (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      });
      const ccRow = chipField("Cc", C.cc), bccRow = chipField("Bcc", C.bcc);
      ccRow.el.style.display = C.cc.length ? "" : "none";
      bccRow.el.style.display = C.bcc.length ? "" : "none";
      const toRow = chipField("To", C.to, el("span", { style: "display:flex;gap:8px;padding-top:5px" }, [el("button", { class: "dm-link", type: "button", onClick: () => {
        ccRow.el.style.display = "";
        ccRow.focus();
      } }, "Cc"), el("button", { class: "dm-link", type: "button", onClick: () => {
        bccRow.el.style.display = "";
        bccRow.focus();
      } }, "Bcc")]));
      function chipField(label, arr, extra) {
        const inp = el("input", { type: "text", "aria-label": label, autocomplete: "off" }), chips = el("div", { class: "dm-chips" }), sug = el("div", { class: "dm-sug", style: "display:none" });
        let st = null, found = [], hi = 0;
        const row = el("div", { class: "dm-fl" }, [el("label", null, label), chips, extra || null, sug]);
        const draw = () => {
          mount(chips, [...arr.map((c, i) => el("span", { class: "dm-chip" + (EMAIL_RE.test(c.email) ? "" : " bad"), title: c.email }, [el("span", null, c.name || c.email), el("button", { type: "button", "aria-label": "Remove " + c.email, onClick: () => {
            arr.splice(i, 1);
            draw();
            touch();
          } }, ic("x", 12))])), inp]);
        };
        const hide = () => {
          sug.style.display = "none";
          found = [];
        };
        const add = (raw, name) => {
          String(raw || "").split(/[,;\s]+/).map((x) => x.trim().replace(/^<|>$/g, "")).filter(Boolean).forEach((e) => {
            e = e.toLowerCase();
            if (!arr.some((c) => c.email === e)) arr.push({ email: e, name: name || "" });
          });
          inp.value = "";
          hide();
          draw();
          touch();
          inp.focus();
        };
        const showSug = () => {
          if (!found.length) return hide();
          mount(sug, found.map((c, i) => el("button", { type: "button", class: i === hi ? "on" : "", onMousedown: (e) => {
            e.preventDefault();
            add(c.email, c.name);
          } }, [c.name || c.email, c.name ? el("small", null, c.email) : null])));
          sug.style.display = "";
        };
        inp.addEventListener("input", () => {
          clearTimeout(st);
          const q = inp.value.trim();
          if (q.length < 2) return hide();
          st = setTimeout(async () => {
            try {
              const r = await api2.dmailContacts(S.acc.id, q);
              found = (r && r.rows || []).filter((c) => c.email !== me2 && !arr.some((a) => a.email === c.email));
              hi = 0;
              showSug();
            } catch (_) {
            }
          }, 200);
        });
        inp.addEventListener("keydown", (e) => {
          if (found.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            hi = (hi + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length;
            showSug();
          } else if (e.key === "Enter" || e.key === "Tab") {
            if (found.length) {
              e.preventDefault();
              add(found[hi].email, found[hi].name);
            } else if (inp.value.trim()) {
              e.preventDefault();
              add(inp.value);
            }
          } else if (e.key === "," || e.key === ";" || e.key === " ") {
            if (inp.value.trim()) {
              e.preventDefault();
              add(inp.value);
            }
          } else if (e.key === "Backspace" && !inp.value && arr.length) {
            arr.pop();
            draw();
            touch();
          }
        });
        inp.addEventListener("blur", () => setTimeout(() => {
          if (inp.value.trim() && !C.closed) {
            const v = inp.value;
            inp.value = "";
            String(v).split(/[,;\s]+/).filter(Boolean).forEach((e) => {
              e = e.toLowerCase();
              if (!arr.some((c) => c.email === e)) arr.push({ email: e, name: "" });
            });
            draw();
            touch();
          }
          hide();
        }, 150));
        inp.addEventListener("paste", (e) => {
          const t = (e.clipboardData || window.clipboardData).getData("text");
          if (/[,;\s]/.test(t.trim())) {
            e.preventDefault();
            add(t);
          }
        });
        draw();
        return { el: row, focus: () => inp.focus() };
      }
      const sigBox = S.acc.signature_html ? (() => {
        const b = el("div", { class: "dm-sig" }, el("div", { class: "lk" }, [ic("lock", 11), "Company signature \u2014 added automatically"]));
        const tmp = document.createElement("template");
        tmp.innerHTML = S.acc.signature_html;
        const inner = el("div");
        inner.innerHTML = cleanHtml(tmp.content);
        b.appendChild(inner);
        return b;
      })() : null;
      let showQ = mode === "forward";
      const qBox = C.quoteHtml ? el("div", { class: "dm-q" }) : null;
      const drawQ = () => {
        if (!qBox) return;
        mount(qBox, [el("button", { class: "dm-link", type: "button", onClick: () => {
          showQ = !showQ;
          drawQ();
        } }, showQ ? "Hide quoted text" : "\u2022\u2022\u2022 Show quoted text"), showQ ? el("div", { class: "qb" }, C.quoteText) : null]);
      };
      const sendBtn = el("button", { class: "dm-btn pri", type: "button", onClick: send }, ["Send", ic("send", 15)]);
      function payload() {
        return { id: C.id, account: S.acc.id, to: C.to, cc: C.cc, bcc: C.bcc, subject: subj.value, html: cleanHtml(ed), text: ed.innerText || "", reply_to: C.replyTo || C.forwardOf || null, mode };
      }
      const isEmpty = () => !C.to.length && !C.cc.length && !C.bcc.length && !subj.value.trim() && !(ed.innerText || "").trim() && !C.files.length;
      let saveT = null;
      function touch() {
        C.dirty = true;
        clearTimeout(saveT);
        saveT = setTimeout(save, 1800);
        saved.textContent = "";
      }
      async function save() {
        clearTimeout(saveT);
        if (!C.dirty || C.closed || isEmpty()) return;
        C.dirty = false;
        if (C.saving) await C.saving;
        C.saving = (async () => {
          try {
            saved.textContent = "Saving\u2026";
            const r = await api2.dmailDraftSave(payload());
            if (r && r.error) throw new Error(r.error);
            if (r && r.id) C.id = r.id;
            saved.textContent = "Draft saved";
          } catch (_) {
            saved.textContent = "Draft not saved";
            C.dirty = true;
          }
        })();
        await C.saving;
        C.saving = null;
      }
      function remove() {
        C.closed = true;
        clearTimeout(saveT);
        win.remove();
        const i = composers.indexOf(handle);
        if (i >= 0) composers.splice(i, 1);
      }
      async function close() {
        await save();
        remove();
        if (S.folder === "drafts" && !S.open) loadList();
        else poll();
      }
      async function discard() {
        const id = C.id;
        remove();
        if (id) {
          try {
            await api2.dmailDraftDiscard(id);
          } catch (_) {
          }
        }
        toast("Draft discarded");
        if (S.folder === "drafts" && !S.open) loadList();
        else poll();
      }
      async function send() {
        const all = C.to.concat(C.cc, C.bcc);
        if (!all.length) {
          toast("Add at least one recipient");
          toRow.focus();
          return;
        }
        const bad = all.find((c) => !EMAIL_RE.test(c.email));
        if (bad) {
          toast("\u201C" + bad.email + "\u201D is not a valid email address");
          return;
        }
        if (!subj.value.trim() && !window.confirm("Send this message without a subject?")) return;
        await save();
        const body = { action: "send", account: S.acc.id, to: C.to, cc: C.cc, bcc: C.bcc, subject: subj.value, html: cleanHtml(ed), draft_id: C.id, reply_to: C.replyTo, forward_of: C.forwardOf, quote_html: C.quoteHtml || "" };
        const files = C.files.slice();
        win.style.display = "none";
        let cancelled = false;
        toast("Sending\u2026", "Undo", () => {
          cancelled = true;
          win.style.display = "";
        }, 5200);
        setTimeout(async () => {
          if (cancelled) return;
          try {
            body.attachments = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, b64: await toB64(f) })));
            await api2.dmailAct(body);
            remove();
            toast("Message sent");
            if (S.open) openRow(S.open);
            else quietReload();
            poll();
          } catch (e) {
            win.style.display = "";
            toast("Not sent \u2014 " + (e && e.message || "try again"), null, null, 7e3);
          }
        }, 5e3);
      }
      const toggleMini = () => {
        if (window.matchMedia("(max-width:860px)").matches) return;
        win.classList.toggle("mini");
        win.classList.remove("full");
      };
      const head = el("div", { class: "dm-ch", onClick: toggleMini }, [title, btn("send", "Send", send, { class: "dm-ib mob-send" }), btn("min", "Minimise", toggleMini, { class: "dm-ib desk" }), btn("max", "Full screen", () => {
        win.classList.toggle("full");
        win.classList.remove("mini");
      }, { class: "dm-ib desk" }), btn("x", "Save and close", close)]);
      const foot = el("div", { class: "dm-cf" }, [sendBtn, el("div", { class: "dm-tb" }, [
        tbtn("bold", "Bold", () => exec("bold")),
        tbtn("italic", "Italic", () => exec("italic")),
        tbtn("under", "Underline", () => exec("underline")),
        tbtn("ul", "Bulleted list", () => exec("insertUnorderedList")),
        tbtn("ol", "Numbered list", () => exec("insertOrderedList")),
        tbtn("link", "Insert link", () => {
          const u = window.prompt("Link address (https://\u2026)");
          if (u && /^(https?:|mailto:)/i.test(u.trim())) exec("createLink", u.trim());
        }),
        tbtn("clip", "Attach files", () => fileInp.click())
      ]), saved, btn("trash", "Discard draft", discard)]);
      const handle = { close, win };
      mount(win, [head, el("div", { class: "dm-cbody" }, [toRow.el, ccRow.el, bccRow.el, el("div", { class: "dm-fl" }, subj), ed, attHost, sigBox, qBox, fileInp, foot])]);
      drawAtts();
      drawQ();
      document.body.appendChild(win);
      composers.push(handle);
      if (composers.length === 2) win.style.right = "min(626px, 52vw)";
      setTimeout(() => {
        if (C.to.length) ed.focus();
        else toRow.focus();
      }, 60);
    }
    const toB64 = (f) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] || "");
      r.onerror = () => rej(new Error("Could not read " + f.name));
      r.readAsDataURL(f);
    });
    function onKey(e) {
      if (S.dead || !root.isConnected) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "c") {
        e.preventDefault();
        compose({});
      } else if (e.key === "/") {
        const i = root.querySelector(".dm-search input");
        if (i) {
          e.preventDefault();
          i.focus();
        }
      } else if ((e.key === "Escape" || e.key === "u") && S.open) closeThread();
      else if (e.key === "r" && S.open && S.msgs) {
        const real = S.msgs.filter((m) => m.folder !== "drafts");
        if (real.length) {
          e.preventDefault();
          compose({ reply: real[real.length - 1], mode: "reply" });
        }
      } else if (e.key === "#" && S.canDel && S.open && S.folder !== "trash") moveRows([S.open], "trash", "Moved to Trash");
    }
    boot();
    return { destroy() {
      S.dead = true;
      clearInterval(pollT);
      clearInterval(syncT);
      document.removeEventListener("keydown", onKey);
      composers.slice().forEach((c) => c.win.remove());
      if (toastEl) toastEl.remove();
    }, refresh: () => syncNow(false), compose: (o) => compose(o || {}) };
  }

  // mnt/loadboot/previews/dispatcher-mail-preview.src.js
  var me = "aziz@loadboot.com";
  var now = Date.now();
  var ago = (min) => new Date(now - min * 6e4).toISOString();
  var P = (email, name) => ({ email, name });
  var M = [
    { id: "m1", thread: "t1", folder: "inbox", from_name: "Dana Whitfield", from_email: "dana@northlinefreight.example", to: [P(me, "Abdul Aziz")], subject: "Rate con \u2014 Dallas TX \u2192 Atlanta GA, 53' dry van, pick Tue", text: "Hi Aziz,\n\nRate confirmation attached for load NL-48213. $2,350 all-in, 781 miles. Please have the carrier sign and return today so we can lock the 08:00 appointment.\n\nThanks,\nDana", html: "<p>Hi Aziz,</p><p>Rate confirmation attached for load <b>NL-48213</b>. <b>$2,350 all-in</b>, 781 miles. Please have the carrier sign and return today so we can lock the 08:00 appointment.</p><p>Thanks,<br>Dana Whitfield<br>Northline Freight (sample)</p>", attachments: [{ idx: 0, name: "RateCon-NL-48213.pdf", type: "application/pdf", size: 184320 }], seen: false, starred: true, date: ago(6) },
    { id: "m2", thread: "t2", folder: "inbox", from_name: "Marcus Reed", from_email: "marcus@bluepeaklogistics.example", to: [P(me, "Abdul Aziz")], subject: "Carrier packet needed before we can tender", text: "Aziz \u2014 before I can tender the Memphis load I need the carrier packet: W-9, COI naming us as certificate holder, and authority letter. Can you send today?", html: null, attachments: [], seen: false, starred: false, date: ago(48) },
    { id: "m3", thread: "t3", folder: "inbox", from_name: "Priya Nair", from_email: "priya@harborbridge.example", to: [P(me, "Abdul Aziz")], subject: "Re: Reefer capacity next week \u2014 Chicago outbound", text: "Thanks Aziz. We will have 3 reefer loads out of Chicago Mon\u2013Wed. I will send lanes and targets tomorrow morning.", html: null, attachments: [], seen: true, starred: false, date: ago(190) },
    { id: "m3a", thread: "t3", folder: "sent", from_name: "Abdul Aziz", from_email: me, to: [P("priya@harborbridge.example", "Priya Nair")], subject: "Reefer capacity next week \u2014 Chicago outbound", text: "Hi Priya,\n\nWe have two 53' reefers empty in Chicago from Monday. Do you have anything outbound to the Southeast?\n\nAziz", html: null, attachments: [], seen: true, starred: false, date: ago(260) },
    { id: "m4", thread: "t4", folder: "inbox", from_name: "Tom Alvarez", from_email: "tom@ironridgecarriers.example", to: [P(me, "Abdul Aziz")], subject: "POD for yesterday's Nashville drop", text: "Signed POD attached. Driver was unloaded by 14:20. Let me know when the invoice goes out.", html: null, attachments: [{ idx: 0, name: "POD-Nashville.jpg", type: "image/jpeg", size: 912384 }], seen: true, starred: false, date: ago(1500) },
    { id: "m5", thread: "t5", folder: "inbox", from_name: "Northline Freight Billing", from_email: "billing@northlinefreight.example", to: [P(me, "Abdul Aziz")], subject: "Remittance advice \u2014 invoice 10447", text: "Payment for invoice 10447 has been scheduled. Remittance details inside.", html: null, attachments: [], seen: true, starred: false, date: ago(4300) },
    { id: "m6", thread: "t6", folder: "sent", from_name: "Abdul Aziz", from_email: me, to: [P("marcus@bluepeaklogistics.example", "Marcus Reed")], subject: "Available: 53' dry van, Memphis, Thursday AM", text: "Marcus \u2014 one dry van empty in Memphis Thursday 07:00. Looking for anything toward Texas.", html: null, attachments: [], seen: true, starred: false, date: ago(900) },
    { id: "m7", thread: "draft:m7", folder: "drafts", from_name: "Abdul Aziz", from_email: me, to: [P("dana@northlinefreight.example", "Dana Whitfield")], subject: "Signed rate con NL-48213", text: "Hi Dana, signed rate con attached.", html: "Hi Dana, signed rate con attached.", attachments: [], seen: true, starred: false, date: ago(3), draft_meta: { mode: "new" } }
  ];
  var delay = (v) => new Promise((r) => setTimeout(() => r(v), 180));
  var counts = () => ({ inbox: new Set(M.filter((m) => m.folder === "inbox" && !m.seen).map((m) => m.thread)).size, drafts: M.filter((m) => m.folder === "drafts").length, spam: 0 });
  var api = {
    dmailBootstrap: () => delay({ enabled: true, staff_view: false, can_delete: false, account: { id: "acc", address: me, display_name: "Abdul Aziz \u2014 LoadBoot Dispatch", signature_html: '<b>Abdul Aziz Shinwari</b><br>Dispatcher \xB7 LoadBoot<br><a href="https://loadboot.com">loadboot.com</a>', status: "active", last_sync_at: ago(0.3), sync_problem: false }, counts: counts() }),
    dmailList: ({ folder, q }) => {
      let b = M.filter((m) => q ? (m.subject + m.text + m.from_name).toLowerCase().includes(q.toLowerCase()) : folder === "starred" ? m.starred : m.folder === folder);
      const by = {};
      b.forEach((m) => {
        (by[m.thread] = by[m.thread] || []).push(m);
      });
      const rows = Object.values(by).map((l) => {
        l.sort((a, c) => a.date < c.date ? 1 : -1);
        const x = l[0], all = M.filter((m) => m.thread === x.thread && m.folder !== "drafts");
        return { thread: x.thread, ids: l.map((m) => m.id), id: x.id, folder: x.folder, date: x.date, unread: l.some((m) => !m.seen), starred: l.some((m) => m.starred), has_attach: l.some((m) => m.attachments.length), subject: x.subject, snippet: x.text.replace(/\s+/g, " ").slice(0, 160), from_name: x.from_name, from_email: x.from_email, to: x.to, total: all.length || 1, names: [...new Set(all.map((m) => m.from_email === me ? "me" : m.from_name))] };
      }).sort((a, c) => a.date < c.date ? 1 : -1);
      return delay({ rows, counts: counts(), last_sync_at: ago(0.3) });
    },
    dmailThread: (a, t) => delay({ messages: M.filter((m) => m.thread === t).sort((a2, c) => a2.date > c.date ? 1 : -1).map((m) => Object.assign({ cc: [], bcc: [], snippet: m.text.slice(0, 120) }, m)) }),
    dmailDraftSave: (p) => delay({ ok: true, id: p.id || "d" + Date.now() }),
    dmailDraftDiscard: (id) => {
      M = M.filter((m) => m.id !== id);
      return delay({ ok: true });
    },
    dmailPoll: () => delay({ counts: counts(), latest: "x", last_sync_at: ago(0.2), sync_problem: false }),
    dmailContacts: (a, q) => delay({ rows: M.filter((m) => m.from_email !== me && (m.from_email + m.from_name).toLowerCase().includes(q.toLowerCase())).map((m) => ({ email: m.from_email, name: m.from_name })).slice(0, 5) }),
    dmailAct: (b) => {
      const ids = new Set(b.ids || []);
      if (b.action === "mark") M.forEach((m) => {
        if (ids.has(m.id)) {
          if ("seen" in b) m.seen = b.seen;
          if ("starred" in b) m.starred = b.starred;
        }
      });
      if (b.action === "move") M.forEach((m) => {
        if (ids.has(m.id)) m.folder = b.to;
      });
      if (b.action === "delete") M = M.filter((m) => !ids.has(m.id));
      if (b.action === "attachment") return delay(new Blob(["sample"]));
      return delay({ ok: true, added: 0 });
    }
  };
  window.__dm = mountDispatcherMail(document.getElementById("host"), { api });
})();
