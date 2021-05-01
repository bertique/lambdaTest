/*jshint esversion: 8 */

const simpleParser = require('mailparser').simpleParser;
const cheerio = require('cheerio');
const chromium = require('chrome-aws-lambda');
const jimp = require('jimp');
const aws = require('aws-sdk');
const { Octokit } = require("@octokit/rest");

const s3 = new aws.S3();
const TOKEN = process.env.GITHUB_TOKEN; // token needs "repo" scope
const DISABLE_S3 = process.env.DISABLE_S3 === "true";
const DISABLE_GIT = process.env.DISABLE_GIT === "true";
const octokit = new Octokit({
  auth: TOKEN
});

const bucket = "lambda-test-1423232123232";

const owner = "bertique";
const repo = "messagefromtheceo";
const imagePath = "assets/images/posts/";

exports.handler = async (event) => {
    
    const firstRecord = event.Records[0];

    console.log('JavaScript trigger function processed a request.');

    const message = JSON.parse(firstRecord.Sns.Message);

    const emailSubject = message.mail.commonHeaders.subject.replace("Fwd: ", '').replace("Fw: ", '');
    const emailSubjectCompressed = emailSubject.replace(/\s/g, '').replace(/\W+/g, '');
    const emailTo = message.mail.destination[0];
    const emailFrom = message.mail.source;
    
    console.log("Subject: %s", emailSubject);
    console.log("From %s, To: %s", emailFrom, emailTo);

    const screenshotPath = `${emailSubjectCompressed}.png`;
    const screenshotPath_full = `${emailSubjectCompressed}_full.png`;

    let parsedEmail = await simpleParser(message.content.replace(/(\\r\\n)/g,"\n"));
    let plainTextEmail = parsedEmail.text
                            .replace(/<http.*>/g, '')
                            .replace(/\[image:[ \n].*\]/g, '')
                            .replace(/\[http.*\]/g, '')
                            .replace(/b\.michael\.dick@gmail\.com/gi, 'info@messagefromtheceo.com')
                            .replace(/[\r\n]{3,}/g, '\r\n');                        
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

    try {
      const image = await jimp.read(screenshot);     
      screenshot = await image.autocrop().quality(100).getBufferAsync(jimp.MIME_PNG);    
    } catch (error) {
      console.log(error);
    }
     
    if(!DISABLE_S3) {
      // Add to S3 bucket
      const dateString = new Date().toISOString().split("T")[0];
      await uploadToS3(`${dateString}-${screenshotPath}`, screenshot);
      await uploadToS3(`${dateString}-${screenshotPath_full}`, screenshot_full);
      await uploadToS3(`${dateString}-${emailSubjectCompressed}.txt`, message.content.replace(/(\\r\\n)/g,"\n"), "text/html");

      console.log("Added to S3");
    } else {
      console.log("Skipping S3");
    }    
    return;
    if(!DISABLE_GIT) {    
      // Create post

      const post = `---\n`+
      `title:  "${emailSubject}"\n`+
      `metadate: "hide"\n`+
      `date: ${dateString} ${new Date().toISOString().split("T")[1].split('.')[0]}\n`+
      `categories: [  ]\n`+
      `image: "/${imagePath}${dateString}-${screenshotPath_full}"\n`+
      `thumbnail: "/${imagePath}${dateString}-${screenshotPath}"\n`+
      `---\n`+
      `${plainTextEmail}\n`;

      // Create pull request

      await createPullRequest(screenshot, `${dateString}-${screenshotPath}`, screenshot_full, `${dateString}-${screenshotPath_full}`, post, `${dateString}-${emailSubjectCompressed}`);

    } else {
      console.log("Skipping Git");
    }  

    const response = {
        statusCode: 200,
        headers: {
            "Content-type": "text/html",            
        },
        body: "done", 
    };
    return response;
};

async function uploadToS3(key, data, contentType) {
  if(contentType == null) {
    contentType = 'image/jpeg';
  }
  const params = { Bucket: bucket, Key: key, Body: data, ContentType: contentType}; //, ACL: 'public-read' };
  await s3.putObject(params).promise();
}

async function createPullRequest(screenshot, screenshotPath, screenshot_full, screenshotPath_full, post, postPath) {
  const branch = "master";

  const {
    data: [
      {
        sha: latestCommitSha,
        commit: {
          tree: { sha: latestCommitTreeSha }
        }
      }
    ]
  } = await octokit.repos.listCommits({
    owner,
    repo,
    sha: branch,
    per_page: 1
  });

  console.log(
    "Last commit sha on %s branch: %s (tree: %s)",
    branch,
    latestCommitSha,
    latestCommitTreeSha
  );

  const {
    data: { sha: newBlobSha }
  } = await octokit.request("POST /repos/:owner/:repo/git/blobs", {
    owner,
    repo,
    content: Buffer.from(screenshot).toString("base64"),
    encoding: "base64"
  });

  const {
    data: { sha: newBlobSha2 }
  } = await octokit.request("POST /repos/:owner/:repo/git/blobs", {
    owner,
    repo,
    content: Buffer.from(screenshot_full).toString("base64"),
    encoding: "base64"
  });

  const {
    data: { sha: newBlobSha3 }
  } = await octokit.request("POST /repos/:owner/:repo/git/blobs", {
    owner,
    repo,
    content: Buffer.from(post).toString("base64"),
    encoding: "base64"
  });

  console.log("Blobs created");

  const {
    data: { sha: newTreeSha }
  } = await octokit.request("POST /repos/:owner/:repo/git/trees", {
    owner,
    repo,
    base_tree: latestCommitTreeSha,
    tree: [
      {
        path: `${imagePath}${screenshotPath}`,
        mode: "100644",
        sha: newBlobSha
      },
      {
        path: `${imagePath}${screenshotPath_full}`,
        mode: "100644",
        sha: newBlobSha2
      },
      {
        path: `_posts/${postPath}.md`,
        mode: "100644",
        sha: newBlobSha3
      }
    ]
  });

  console.log("tree created: %s", newTreeSha);

  const { data: commit } = await octokit.git.createCommit({
    owner,
    repo,
    message: `Adding three files for new post on ${postPath}`,
    tree: newTreeSha,
    parents: [latestCommitSha]
  });

  console.log(`commit created`);

  let ref = `heads/${postPath}`;
  const { data: listRefsResponse } = await octokit.git.listMatchingRefs({
    owner,
    repo,
    ref
  });

  if(listRefsResponse.length == 0) {
    ref = `refs/heads/${postPath}`;
    const { data: createRefsResponse } = await octokit.git.createRef({
      owner,
      repo,
      ref,
      sha: commit.sha
    });
  }

  console.log(`branch created`);

  const { data: createPullRequestResponse } = await octokit.pulls.create({
    owner,
    repo,
    title: `Adding post for ${postPath}`,
    head: `${owner}:${postPath}`,
    base: branch,
    body: "Update post content and merge to post"
  });

  console.log(`Pull request created`);
}