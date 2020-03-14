/*jshint esversion: 8 */

const simpleParser = require('mailparser').simpleParser;
const cheerio = require('cheerio');
const chromium = require('chrome-aws-lambda');
const aws = require("aws-sdk");

const s3 = new aws.S3();

exports.handler = async (event) => {
    
    const firstRecord = event.Records[0];

    console.log('JavaScript trigger function processed a request.');

    const message = JSON.parse(firstRecord.Sns.Message);

    const emailSubject = message.mail.commonHeaders.subject.replace("Fwd: ", '');
    const emailSubjectCompressed = emailSubject.replace(/\s/g, '').replace(/\W+/g, '')
    const emailTo = message.mail.destination[0];
    const emailFrom = message.mail.source;
    
    console.log("Subject: %s", emailSubject);
    console.log("From %s, To: %s", emailFrom, emailTo);

    const screenshotPath = `${emailSubjectCompressed}.png`;
    const screenshotPath_full = `${emailSubjectCompressed}_full.png`;

    let parsedEmail = await simpleParser(message.content.replace(/(\\r\\n)/g,"\n"));
    let parsedEmailCheerio = cheerio.load(parsedEmail.html);

    // parsedEmailCheerio('img').each(function(i, image) {
        
    //     let localImageUrl = filenamifyUrl(cheerio(this).attr('src'));

    //     download(cheerio(this).attr('src')).pipe(fs.createWriteStream(tempFolder+'/outbox/'+emailAssetsFolder+'/'+emailSubject+'/'+localImageUrl));
    //     cheerio(this).attr('src', emailAssetsFolder+'/'+emailSubject+'/'+localImageUrl);
    // });

    // parsedEmailCheerio('a').each(function(i, link) {
    //     cheerio(this).attr('href','./').css('cursor', 'default').css('pointer-events', 'none');
    // });

    let browser = null;
    let screenshot, screenshot_full = null;
    
    try {
      browser = await chromium.puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        headless: chromium.headless,
      });
  
      let page = await browser.newPage();
      await page.setContent(parsedEmailCheerio.html(), {waitUntil: 'load'});
      await page.setViewport({
        width: 1024,
        height: 768
      });    

      screenshot = await page.screenshot({ type: "png", fullPage: false });
      screenshot_full = await page.screenshot({ type: "png", fullPage: true });
  
    } catch (error) {
      console.log(error);
    } finally {
      if (browser !== null) {
        await browser.close();
      }
    }

    // Add to S3 bucket

    uploadToS3(screenshotPath, screenshot);
    uploadToS3(screenshotPath_full, screenshot_full);

    console.log("Added to S3");

    // Create post

    const post = `---`+
    `title:  "${emailSubject}"`+
    `metadate: "hide"`+
    `categories: [  ]`+
    `image: "/assets/images/${screenshotPath_full}"`+
    `thumbnail: "/assets/images/${screenshotPath}"`+
    `htmlmail: ""`+
    `---`+
    `Post content`;

    const response = {
        statusCode: 200,
        headers: {
            "Content-type": "text/html",            
        },
        body: "done", 
    };
    return response;
};

function uploadToS3(key, data) {
  const bucket = "lambda-test-1423232123232";

  const params = { Bucket: bucket, Key: key, Body: data, ContentType: 'image/jpeg', ACL: 'public-read' };
  s3.putObject(params).promise();
}