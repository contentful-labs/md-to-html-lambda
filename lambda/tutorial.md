# Combining Contentful and AWS Lambda

This tutorial will show you how you can use two new Amazon products, [Lambda][]
and [API Gateway][], to provide additional functionality on top of Contentful's
Delivery API. We will be implementing a simple transform that renders markdown
in `Text` fields to HTML.

What is Lambda:
 - a service from Amazon that will run your code in response to events
What is API Gateway
 - a service for managing HTTP endpoints that can send events to Lambda
   (as well as proxying requests other HTTP backends).

What our new API Gateway will do:
 - Expose a single endpoint that accepts contentful search parameters
 - This endpoint will send a request to `https://cdn.contentful.com/spaces/{spaceId}/entries{?query}
 - Transform the response using [contentful-resource-transform][] and [marked][]. Then reply to the original request.


[Lambda]: http://lol
[API Gateway]: http://lol
[contentful-resource-transform]: https://github.com/contentful/contentful-resource-transform
[marked]: https://github.com/chjj/marked

## Steps:

1. Create the code
  - create a new directory 
1. Sign in to the [AWS Console][]
2. Select "Lambda" from the "Services" section of the top menu.
3. Select "Create a new lambda" 
Lambda is a new service from Amazon that
allows to 
without needing to monitor or run any
in
