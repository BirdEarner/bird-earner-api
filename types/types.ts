import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const AdminRole = {
    admin: "admin",
    superadmin: "superadmin"
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];
export const ContactStatus = {
    pending: "pending",
    in_progress: "in_progress",
    resolved: "resolved",
    closed: "closed"
} as const;
export type ContactStatus = (typeof ContactStatus)[keyof typeof ContactStatus];
export const JobStatus = {
    OPEN: "OPEN",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    PAUSED: "PAUSED"
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];
export const EarningStatus = {
    PENDING: "PENDING",
    APPROVED: "APPROVED",
    PAID: "PAID",
    CANCELLED: "CANCELLED"
} as const;
export type EarningStatus = (typeof EarningStatus)[keyof typeof EarningStatus];
export const WithdrawalStatus = {
    PENDING: "PENDING",
    APPROVED: "APPROVED",
    PROCESSED: "PROCESSED",
    REJECTED: "REJECTED"
} as const;
export type WithdrawalStatus = (typeof WithdrawalStatus)[keyof typeof WithdrawalStatus];
export const PaymentStatus = {
    PENDING: "PENDING",
    RESERVED: "RESERVED",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    REFUNDED: "REFUNDED",
    CANCELLED: "CANCELLED"
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const TransactionType = {
    DEPOSIT: "DEPOSIT",
    WITHDRAWAL: "WITHDRAWAL",
    JOB_PAYMENT: "JOB_PAYMENT",
    JOB_REFUND: "JOB_REFUND",
    JOB_RESERVE: "JOB_RESERVE",
    JOB_RELEASE: "JOB_RELEASE",
    PENALTY: "PENALTY",
    BONUS: "BONUS",
    PLATFORM_FEE: "PLATFORM_FEE"
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];
export const ServiceCategory = {
    FREELANCE: "FREELANCE",
    HOUSEHOLD: "HOUSEHOLD"
} as const;
export type ServiceCategory = (typeof ServiceCategory)[keyof typeof ServiceCategory];
export const ChatStatus = {
    PENDING: "PENDING",
    ACCEPTED: "ACCEPTED",
    REJECTED: "REJECTED",
    COMPLETED: "COMPLETED",
    BLOCKED: "BLOCKED"
} as const;
export type ChatStatus = (typeof ChatStatus)[keyof typeof ChatStatus];
export const DeleteRequestStatus = {
    PENDING: "PENDING",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED"
} as const;
export type DeleteRequestStatus = (typeof DeleteRequestStatus)[keyof typeof DeleteRequestStatus];
export const CashbackOfferAmountType = {
    LUMPSUM: "LUMPSUM",
    PERCENT: "PERCENT"
} as const;
export type CashbackOfferAmountType = (typeof CashbackOfferAmountType)[keyof typeof CashbackOfferAmountType];
export type Admin = {
    id: Generated<number>;
    name: string;
    email: string;
    password: string;
    role: AdminRole;
    lastLoginAt: Timestamp | null;
    lastLoginIp: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type BankAccount = {
    id: string;
    userId: string;
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type BlockedUser = {
    id: string;
    blockerId: string;
    blockedId: string;
    blockerType: string;
    blockedType: string;
    reason: string | null;
    createdAt: Generated<Timestamp>;
};
export type CashbackOffer = {
    id: string;
    amount: number;
    amountType: CashbackOfferAmountType;
    discovered: Generated<boolean>;
    used: Generated<boolean>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
    clientId: string;
};
export type ChatThread = {
    id: string;
    jobId: string;
    freelancerId: string;
    clientId: string;
    characterLimit: Generated<number>;
    isAccepted: Generated<boolean>;
    status: Generated<ChatStatus>;
    createdAt: Generated<Timestamp>;
    deadline: Timestamp | null;
    updatedAt: Timestamp;
    usedStorage: Generated<string>;
    storageLimit: Generated<string>;
};
export type Client = {
    id: string;
    userId: string;
    phase1Completed: Generated<boolean>;
    phase2Completed: Generated<boolean>;
    organizationType: string | null;
    companyName: string | null;
    city: string | null;
    state: string | null;
    zipcode: number | null;
    country: string | null;
    profileDescription: string | null;
    profilePhoto: string | null;
    termsAccepted: boolean | null;
    wallet: Generated<string>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
    availableBalance: Generated<string>;
    reservedAmount: Generated<string>;
    availabilityUpdatedAt: Timestamp | null;
    currentlyAvailable: Generated<boolean | null>;
    nextAvailable: string | null;
    coverPhoto: string | null;
};
export type Contact = {
    id: string;
    ticketId: string;
    name: string;
    email: string;
    phone: string | null;
    subject: string;
    message: string;
    isRead: Generated<boolean>;
    status: Generated<ContactStatus>;
    adminResponse: string | null;
    adminId: number | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type DeleteRequest = {
    id: string;
    userId: string;
    userType: string;
    reason: string | null;
    status: Generated<DeleteRequestStatus>;
    processedAt: Timestamp | null;
    processedBy: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type Earning = {
    id: string;
    freelancerId: string;
    jobId: string | null;
    amount: string;
    earningType: string;
    description: string | null;
    status: Generated<EarningStatus>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type FAQ = {
    id: Generated<number>;
    question: string;
    answer: string;
    keywords: string | null;
    youtubeLink: string | null;
};
export type FileManagement = {
    id: string;
    fileName: string;
    originalName: string;
    fileUrl: string;
    fileSize: number;
    mimeType: string;
    uploadedBy: string;
    uploaderType: string;
    category: string | null;
    isActive: Generated<boolean>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type Freelancer = {
    id: string;
    userId: string;
    mobileNumber: string | null;
    phase1Completed: Generated<boolean>;
    phase2Completed: Generated<boolean>;
    selectedServices: unknown | null;
    highestQualification: string | null;
    experience: number | null;
    profileHeading: string | null;
    city: string | null;
    state: string | null;
    zipcode: number | null;
    country: string | null;
    gender: string | null;
    dob: Timestamp | null;
    certifications: unknown | null;
    socialMediaLinks: unknown | null;
    profileDescription: string | null;
    profilePhoto: string | null;
    portfolioImages: unknown | null;
    coverPhoto: string | null;
    currentlyAvailable: Generated<boolean | null>;
    nextAvailable: string | null;
    termsAccepted: boolean | null;
    flags: unknown | null;
    xp: Generated<number>;
    level: Generated<number>;
    rating: number | null;
    assignedJobs: unknown | null;
    cancelledJobs: unknown | null;
    totalEarnings: Generated<string>;
    monthlyEarnings: Generated<string>;
    outstandingAmount: Generated<string>;
    withdrawableAmount: Generated<string>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
    availabilityUpdatedAt: Timestamp | null;
};
export type Job = {
    id: string;
    jobTitle: string;
    jobDescription: string;
    jobCategory: string;
    jobSubCategory: string;
    skillsRequired: unknown;
    projectType: string;
    budgetType: string;
    budgetAmount: string;
    clientId: string;
    paymentMethod: Generated<string>;
    birdFeeAmount: string | null;
    birdFeePaid: Generated<boolean>;
    assignedFreelancerId: string | null;
    createdBy: string | null;
    serviceId: string | null;
    jobStatus: Generated<JobStatus>;
    proposalCount: Generated<number>;
    deadlineDate: Timestamp | null;
    assignedAt: Timestamp | null;
    attachedFiles: unknown | null;
    location: string | null;
    latitude: string | null;
    longitude: string | null;
    isUrgent: Generated<boolean | null>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
    amountPaid: Generated<string | null>;
    isAmountReserved: Generated<boolean>;
    paymentStatus: Generated<PaymentStatus>;
    completedAt: Timestamp | null;
};
export type JobBookmark = {
    id: string;
    userId: string;
    jobId: string;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type Message = {
    id: string;
    senderId: string;
    receiverId: string;
    jobId: string | null;
    messageContent: string;
    messageType: Generated<string>;
    messageData: Generated<unknown>;
    attachments: unknown | null;
    isRead: Generated<boolean>;
    senderType: string;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
    chatThreadId: string | null;
};
export type Notification = {
    id: string;
    userId: string;
    userType: string;
    title: string;
    message: string;
    type: string;
    data: unknown | null;
    isRead: Generated<boolean>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type PaymentHistory = {
    id: string;
    clientId: string | null;
    jobId: string | null;
    amount: string;
    paymentMethod: string;
    transactionId: string | null;
    status: Generated<PaymentStatus>;
    description: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
    freelancerId: string | null;
};
export type PushToken = {
    id: string;
    userId: string;
    userType: string;
    token: string;
    platform: string;
    isActive: Generated<boolean>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type Review = {
    id: string;
    reviewerId: string;
    revieweeId: string;
    jobId: string | null;
    rating: number;
    ratingDetails: unknown | null;
    reviewText: string | null;
    reviewType: string;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
    freelancerId: string | null;
    clientId: string | null;
};
export type Service = {
    id: string;
    name: string;
    category: ServiceCategory;
    description: string | null;
    imageUrl: string | null;
    isActive: Generated<boolean>;
    priorityConfig: unknown | null;
    birdFee: unknown | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type User = {
    id: string;
    email: string;
    password: string;
    fullName: string | null;
    isTestAccount: Generated<boolean>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
    resetPasswordExpires: string | null;
    resetPasswordToken: string | null;
};
export type UserEgg = {
    id: string;
    freelancerId: string;
    eggType: string;
    quantity: Generated<number>;
    earnedFrom: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type UserMedia = {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    location: string;
    path: string;
    uploaderId: string;
    threadId: string;
    messageId: string;
    expiresAt: Timestamp;
    isExpired: Generated<boolean>;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type WalletTransaction = {
    id: string;
    userId: string;
    userType: string;
    jobId: string | null;
    transactionType: TransactionType;
    amount: string;
    balanceBefore: string;
    balanceAfter: string;
    description: string | null;
    referenceId: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type WithdrawalRequest = {
    id: string;
    freelancerId: string;
    amount: string;
    bankDetails: unknown;
    status: Generated<WithdrawalStatus>;
    processedAt: Timestamp | null;
    notes: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type DB = {
    admins: Admin;
    bankAccounts: BankAccount;
    blockedUsers: BlockedUser;
    cashbackOffers: CashbackOffer;
    chatThreads: ChatThread;
    clients: Client;
    contacts: Contact;
    deleteRequests: DeleteRequest;
    earnings: Earning;
    faqTable: FAQ;
    fileManagement: FileManagement;
    freelancers: Freelancer;
    jobBookmarks: JobBookmark;
    jobs: Job;
    messages: Message;
    notifications: Notification;
    paymentHistory: PaymentHistory;
    pushTokens: PushToken;
    reviews: Review;
    services: Service;
    userEggs: UserEgg;
    userMedia: UserMedia;
    users: User;
    walletTransactions: WalletTransaction;
    withdrawalRequests: WithdrawalRequest;
};
