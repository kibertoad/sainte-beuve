import { defineApiContract } from '@toad-contracts/valibot'
import { reviewReportQuerySchema, reviewReportSchema } from '../reporting.js'
import { errorResponses } from './_shared.js'

// Reports route contract. See ReportingController in @sainte-beuve/server.

export const getReviewReportContract = defineApiContract({
  method: 'get',
  requestQuerySchema: reviewReportQuerySchema,
  pathResolver: () => '/reports/reviews',
  responsesByStatusCode: { 200: reviewReportSchema, ...errorResponses },
})
