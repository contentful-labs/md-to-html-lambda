.PHONY: deploy

lambda.zip: lambda/index*.js lambda/package.json
	cd lambda && \
	npm install --production 2>/dev/null 1>/dev/null && \
	zip -r ../lambda.zip * && cd -

deploy: lambda.zip
	cd deploy && \
	npm install 2>/dev/null 1>/dev/null && \
	./node_modules/.bin/babel-node --stage=2 $(NODE_DEBUG) deploy.js

