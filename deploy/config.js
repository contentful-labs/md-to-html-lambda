if (!process.env.AWS_ACCOUNT_ID) {
  throw new Error('AWS_ACCOUNT_ID environment variable must be set!')
}

exports.apiName = exports.lambdaName = 'cf-md-to-html'
exports.region = process.env.AWS_DEFAULT_REGION || "eu-west-1"

// This is the default role created by AWS when you create a lambda through the
// AWS console.
exports.accountId = process.env.AWS_ACCOUNT_ID
exports.lambdaRole = `arn:aws:iam::${exports.accountId}:role/lambda_basic_execution`
