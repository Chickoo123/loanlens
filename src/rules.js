// Every check in LoanLens points to one of these primary sources.
// `verified` is the date this summary was last checked against the source.
// Wording is deliberately conservative: we paraphrase, and link to the original.

export const RULES = {
  kfs: {
    name: "RBI circular: Key Facts Statement (KFS) for Loans & Advances",
    ref: "DOR.STR.REC.13/13.03.00/2024-25",
    date: "15 Apr 2024 (in force from 1 Oct 2024)",
    url: "https://website.rbi.org.in/documents/87730/39710850/Circular+KFS_180424_Final_For_Website.pdf",
    summary: "Lenders must give a KFS for retail and MSME loans showing an all-inclusive Annual Percentage Rate (APR) that covers interest and all charges, including third-party charges collected by the lender. Charges not mentioned in the KFS cannot be levied without the borrower's explicit consent.",
    verified: "2026-11-08",
  },
  fairInterest: {
    name: "RBI circular: Fair Practices Code for Lenders – Charging of Interest",
    ref: "RBI/2024-25/30",
    date: "29 Apr 2024",
    url: "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12678",
    summary: "RBI found lenders (a) charging interest from the sanction or agreement date instead of the actual disbursal date, (b) collecting instalments in advance but charging interest on the full loan amount, and (c) charging interest for a whole month for part-month periods. Lenders were told to stop and refund excess interest.",
    verified: "2026-11-08",
  },
  penal: {
    name: "RBI circular: Fair Lending Practice – Penal Charges in Loan Accounts",
    ref: "RBI/2023-24/53",
    date: "18 Aug 2023 (in force from 1 Jan 2024)",
    url: "https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=12527",
    summary: "Penalties for breaching loan terms must be a 'penal charge', not 'penal interest' added to the interest rate, and must not be capitalised (no interest on penal charges). Amount and reason must be disclosed in the loan agreement and KFS.",
    verified: "2026-11-08",
  },
  prepayment: {
    name: "RBI (Pre-payment Charges on Loans) Directions, 2025",
    ref: "Notification Id 12878",
    date: "2 Jul 2025 (loans sanctioned or renewed on/after 1 Jan 2026)",
    url: "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878",
    summary: "No pre-payment charges on floating-rate loans to individuals for non-business purposes. Business loans to individuals and MSEs are also covered, with some lender-category exceptions. Any permitted charge must be disclosed in the sanction letter, agreement and KFS.",
    verified: "2026-11-08",
  },
  digital: {
    name: "RBI (Digital Lending) Directions, 2025",
    ref: "Notification Id 12848",
    date: "8 May 2025",
    url: "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12848",
    summary: "Borrowers must get a cooling-off period of at least one day, disclosed in the KFS, during which they can exit by repaying principal and the proportionate APR without penalty. Every loan offer must show the lender's name, APR and a link to the KFS.",
    verified: "2026-11-08",
  },
  ombudsman: {
    name: "RBI Integrated Ombudsman Scheme, 2021: Complaint Management System",
    ref: "cms.rbi.org.in",
    date: "",
    url: "https://cms.rbi.org.in",
    summary: "Complain to the lender first. If it rejects the complaint, doesn't reply within 30 days, or you're unhappy with the reply, you can file with the RBI Ombudsman online at no cost.",
    verified: "2026-11-08",
  },
};
