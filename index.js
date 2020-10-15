#!/usr/bin/env node

//Configuration set
var config = require('./config.js');

//Modules
const fs = require('fs')
const nodemailer = require("nodemailer");
var sendinBlue = require('nodemailer-sendinblue-transport');
const puppeteer = require('puppeteer');

//Delay function that can be used within async blocks
function delay(time) {
	return new Promise(function(resolve) {
		setTimeout(resolve, time)
	});
}

//Park-specific search request setup
var park_url = {
	site: 'https://texasstateparks.reserveamerica.com',
	path: '/unifSearchInterface.do',
	params: [],
}
park_url.params.push("interface=camping")
park_url.params.push("contractCode=TX")
park_url.params.push("parkId=0"); //replace with park id to search

var now = new Date();
var ts = now.toISOString();

console.log("--------------------------\n"+ts+"\n--------------------------");

var saveresults = {};
var lastresults = false;
var output = "";

//See if previous results have been stored.  If so, read them in.
fs.exists('results.json', function(exists){
	if (exists){
        	fs.readFile('results.json', 'utf-8', (err, data) => {
 	               if (err) {throw err;}
        	        lastresults = JSON.parse(data.toString());
		})
	}
});


(async() => {

	const browser = await puppeteer.launch()
	const page = await browser.newPage()


        //Loop through the defined searches
        for (var s=0; s<config.searches.length; s++){

                var search = config.searches[s];

		await page.goto('https://texasstateparks.reserveamerica.com');

		//This will do an initial search in the Houston region.
		//This is required to set up the search dates in the session
		//Subsequent queries to each park will use the stored session dates to list availability
		console.log("Performing search for "+search.start_date+" for "+search.nights+" nights...");
		await page.type('#locationCriteria',"houston");
		await delay(2000);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await page.$eval('#interest', el => el.value = "camping");
		await delay(2000);
		await page.$eval('#campingDate', (el,search) => el.value = search.start_date, search);
		await page.$eval('#lengthOfStay', (el,search) => el.value = search.nights, search);
	
		//await page.screenshot({ path: 'test.png', fullPage: true }); //if needed for debugging
	
		await page.click('button[type="submit"]');
		await page.waitForNavigation();
	
		saveresults[s] = {};
		output = "Results for "+search.start_date+" for "+search.nights+" nights:\n\n";
	
		//Loop through the parks listed in parks.js
		for (var i=0; i<search.parks.length; i++){

			var park = search.parks[i];
			
			//Modify the type of search in the search parameters
			park_url.params[0] = "interface=camping";

			//Modify the park ID in the search parameters, and submit the request
			park_url.params[park_url.params.length-1] = "parkId="+park.id;
      			 	await page.goto(park_url.site+park_url.path+"?"+park_url.params.join("&"));
		        
			//Parse the response to get the number of sites available
			const results = await page.$eval('.searchSummary > .matchSummary', e => e.innerHTML);
			var tags = results.match(/^(\d+)\s/)
			numsites = tags[1];

	                console.log(park.name+": "+tags[1]+" sites available");
			output += "\n" + park.name+": "+tags[1]+" sites available" + "\n";
	
			//If one or more sites available, then parse out and list the site types
			if (numsites != '0'){
	
				const types = await page.$$('.filters a');
				var typearr = [];
				for (var j = 0; j < types.length; j++) {
 						const typetext = await (await types[j].getProperty('innerText')).jsonValue();
 						typearr.push(typetext);
				}
				var uniqueTypes = Array.from(new Set(typearr))
				console.log("\t"+uniqueTypes.join(","));
				output += ">>> "+uniqueTypes.join(",")+"\n";
			}
	
			//Store the result to be saves to a file once we're done
			saveresults[s][park.id] = numsites;
		}

	
		//Check if there are sites available that weren't on the last check
		//If so, send an email
		await check_for_changes(s);
	
	} //end of this search

	await browser.close();
	
	//Save the results to be compared on the next check
	await save_results();

})();

function check_for_changes(searchnum){

	var parks = config.searches[searchnum].parks

	//compare each park's available site count to the last check.  Mark any that have increased.
	var changed = [];
       	if (lastresults){
                for (var i=0; i<parks.length; i++){
	                if (Number(saveresults[searchnum][parks[i].id]) > Number(lastresults[searchnum][parks[i].id])) changed.push(parks[i].name);
                }
        }

	//if any increased, send out an email alert
        if (changed.length > 0){

                console.log("Change detected");

                var client = nodemailer.createTransport({
                        service: 'SendinBlue',
                        auth: {
                              user: config.sendinblue_user,
                              pass: config.sendinblue_api_key
        	        }
                });

                var now = new Date();
                var ts = now.toISOString();

                client.sendMail({
		    from: config.mail_from, // sender address
                    to: config.searches[searchnum].mail_to, // list of receivers
                    subject: "Campsite(s) Found - "+ts, // Subject line
                    text: "New site(s) at: " + changed.join(', ') + "\n\n" + output, // plain text body
                });


        }


}

function save_results(){

	const data = JSON.stringify(saveresults);
        fs.writeFile('results.json', data, (err) => {
                if (err) {throw err;}
        });


}
