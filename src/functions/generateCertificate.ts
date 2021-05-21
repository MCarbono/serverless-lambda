import chromium from 'chrome-aws-lambda';
import { S3 } from 'aws-sdk';

import path from 'path';
import handlebars from 'handlebars';
import fs from 'fs';

import dayjs from 'dayjs';

import { document } from '../utils/dynamodbClient';

interface ICreateCertificate {
    id: string;
    name: string;
    grade: string;
}

interface ITemplate {
    id: string;
    name: string;
    grade: string;
    date: string;
    medal: string;
}

const compile = async function(data: ITemplate) {
    const filePath = path.join(process.cwd(), "src", "templates", "certificate.hbs")

    const html = fs.readFileSync(filePath, "utf-8");

    return handlebars.compile(html)(data);
}

export const handle = async (event) => {
    const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;

    const response = await document.query({
        TableName: "users_certificates",
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: {
            ":id": id
        },
    }).promise();

    const userAlreadyExists =  response.Items[0];

    if(!userAlreadyExists){
        await document.put({
            TableName: "users_certificates",
            Item: {
                id,
                name,
                grade
            }
        }).promise();
    }
    
     //readFileSync = 1 parametro: path do arquivo, 2 parâmetro: formato do arquivo desejado.
    const medalPath = path.join(process.cwd(), "src", "templates", "selo.png");
    const medal = fs.readFileSync(medalPath, "base64");

    const data: ITemplate = {
        date: dayjs().format("DD/MM/YYYY"),
        grade,
        name,
        id,
        medal
    }
    // Gera o certificado

    // Compilar usando handlebars, handlebars p/ pdf
    const content = await compile(data)

    //Transformar em PDF
    const browser = await chromium.puppeteer.launch({
        headless: true,
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath
    })

    const page = await browser.newPage();

    await page.setContent(content)

    const pdf = await page.pdf({
        //formato da folha
        format: "a4",
        landscape: true,
        //código usado para poder testar localmente o pdf(dev mode)
        path: process.env.IS_OFFLINE ? "certificate.pdf": null,
        printBackground: true,
        preferCSSPageSize: true
    })

    await browser.close();

    //Salvar no S3
    const s3 = new S3();

    await s3.putObject({
        Bucket: "serverlessignitecertificate",
        Key: `${id}.pdf`,
        ACL: "public-read",
        Body: pdf,
        ContentType: "application/pdf",
    }).promise();

    return {
        statusCode: 201,
        body: JSON.stringify({
            message: "Certificate created!",
            url: `https://serverlessignitecertificate.s3-sa-east-1.amazonaws.com/${id}.pdf`
        }),
        headers: {
            "Content-type": "application/json",
        }
    }
}

//query scan on shell
/**
 *
 *  var params = {
    TableName: "users_certificates"
}

dynamodb.scan(params, function(err, data){
    if(err) ppJson(err)
    else ppJson(data)
}) 
 *
 */