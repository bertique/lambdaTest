/*jshint esversion: 8 */

let download = require('download');
let simpleParser = require('mailparser').simpleParser;
let cheerio = require('cheerio');
let chromium = require('chrome-aws-lambda');
let filenamifyUrl = require('filenamify-url');
let aws = require("aws-sdk");

const emailAssetsFolder = 'email_assets';

exports.handler = async (event) => {
    
    let firstRecord = event.Records[0];

    console.log(JSON.parse(firstRecord.Sns.Message).mail.commonHeaders.subject);
    console.log('JavaScript trigger function processed a request.');
    
    let emailSubject = JSON.parse(firstRecord.Sns.Message).mail.commonHeaders.subject.replace(/\s/g, '').replace(/\W+/g, '');

    let parsedEmail = await simpleParser(JSON.parse(firstRecord.Sns.Message).content.replace(/(\\r\\n)/g,"\n"));

    //console.log(firstRecord.Sns.Message.content.replace(/(\\r\\n)/g,"\n"));

    let parsedEmailCheerio = cheerio.load(parsedEmail.html);

    // parsedEmailCheerio('img').each(function(i, image) {
        
    //     let localImageUrl = filenamifyUrl(cheerio(this).attr('src'));

    //     download(cheerio(this).attr('src')).pipe(fs.createWriteStream(tempFolder+'/outbox/'+emailAssetsFolder+'/'+emailSubject+'/'+localImageUrl));
    //     cheerio(this).attr('src', emailAssetsFolder+'/'+emailSubject+'/'+localImageUrl);
    // });

    // parsedEmailCheerio('a').each(function(i, link) {
    //     cheerio(this).attr('href','./').css('cursor', 'default').css('pointer-events', 'none');
    // });


    // fs.writeFileSync(tempFolder+'/outbox/'+emailSubject+'.html', parsedEmailCheerio.html());

    console.log(parsedEmailCheerio.html());

    let buffer = null;
    let browser = null;
  
    try {
      browser = await chromium.puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        headless: chromium.headless,
      });
  
      let page = await browser.newPage();
      await page.setContent(parsedEmailCheerio.html(), {waitUntil: 'load'});
      
      buffer = await page.screenshot({ type: "png" });
      //buffer = Buffer.from(b64string, "base64");
  
    } catch (error) {
      console.log(error);
    } finally {
      if (browser !== null) {
        await browser.close();
      }
    }

    const s3 = new aws.S3();
    const bucket = "lambda-test-1423232123232";
    const key = emailSubject+".png";

    const params = { Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/jpeg', ACL: 'public-read' };
    await s3.putObject(params).promise();

    const response = {
        statusCode: 200,
        headers: {
            "Content-type": "text/html",            
        },
        body: "done", 
    };
    return response;
};