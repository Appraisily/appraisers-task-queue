# Appraisers Task Queue Process Flow

```mermaid
flowchart TD
    subgraph "API Server (app.js)"
        A[HTTP POST /api/process-step] --> B{Request Validation: id, startStep?};
        B -- Valid --> C[Find Appraisal Sheet: appraisalFinder.appraisalExists(id)];
        B -- Invalid --> D[Return 400 Error];
        C --> E{Sheet Found?};
        E -- Yes --> F[Call worker.processFromStep(id, startStep, usingCompletedSheet, options)];
        E -- No --> G[Return 404 Error];
        F --> H[Return 200 Success];
        F -- Error --> I[Log Error & Return 500 Error];

        AA[HTTP POST /api/analyze-image-and-merge] --> AB{Request Validation: id, postId?};
        AB -- Valid --> AC[Call worker.analyzeImageAndMergeDescriptions(id, postId, description, options)];
        AB -- Invalid --> AD[Return 400 Error];
        AC --> AE[Return 200 Success with Data];
        AC -- Error --> AF[Log Error & Return 500 Error];
    end

    subgraph "Worker Logic (worker.js)"
        F --> W1{Switch (startStep)};
        W1 -- STEP_SET_VALUE --> W2[Update Status: Processing];
        W2 --> W3[Call appraisalService.processAppraisal];
        W3 --> H;
        W3 -- Error --> W_Fail[Update Status: Failed] --> I;

        W1 -- STEP_MERGE_DESCRIPTIONS --> W4[Update Status: Analyzing];
        W4 --> W5[Call worker.analyzeImageAndMergeDescriptions];
        W5 --> W6[Save titles/desc to Sheets (S, T)];
        W6 --> W7[Update WP Post: title, detailedtitle];
        W7 --> W8[Update Status: Ready];
        W8 --> H;
        W5 -- Error --> W_Fail;
        W6 -- Error --> W_Fail;
        W7 -- Error --> W_Fail;

        W1 -- STEP_UPDATE_WORDPRESS --> W9[Update Status: Updating];
        W9 --> W10[Fetch Data (B, J, L)];
        W10 --> W11[Call appraisalService.updateWordPress];
        W11 --> H;
        W11 -- Error --> W_Fail;

        W1 -- STEP_GENERATE_VISUALIZATION --> W12[Log: Generating Visualization];
        W12 --> W13[Call appraisalService.wordpressService.completeAppraisalReport];
        W13 --> H;
        W13 -- Error --> W_Fail;

        W1 -- STEP_GENERATE_PDF --> W14[Update Status: Finalizing];
        W14 --> W15[Get Post ID (if needed)];
        W15 --> W16[Get WP Permalink];
        W16 --> W17[Call appraisalService.finalize];
        W17 --> W18{PDF Valid?};
        W18 -- Yes --> W19[Update Status: PDF Created];
        W18 -- No --> W_FailPDF[Update Status: Failed - Invalid PDF];
        W19 --> W20{From Pending Sheet?};
        W20 -- Yes --> W21[Update Status: Completed];
        W20 -- No --> H;
        W21 --> H;
        W17 -- Error --> W_Fail;

        W1 -- STEP_BUILD_REPORT --> W22[Update Status: Processing];
        W22 --> W23[Fetch Data (B, J, K)];
        W23 --> W24[Call appraisalService.processAppraisal];
        W24 --> H;
        W24 -- Error --> W_Fail;

        W1 -- Default/Unknown --> W25[Update Status: Processing];
        W25 --> W26[Fetch Data (B, J, K)];
        W26 --> W27[Call appraisalService.processAppraisal];
        W27 --> H;
        W27 -- Error --> W_Fail;

        AC --> W_ImgMerge1[Call worker.analyzeImageAndMergeDescriptions internally];
        W_ImgMerge1 --> AE;
        W_ImgMerge1 -- Error --> AF;

        subgraph "analyzeImageAndMergeDescriptions (Internal)"
            W_ImgMergeInt1[Start Image Analysis & Merge] --> W_ImgMergeInt2{AI Desc Exists (Col H)?};
            W_ImgMergeInt2 -- Yes --> W_ImgMergeInt7[Use Existing AI Desc];
            W_ImgMergeInt2 -- No --> W_ImgMergeInt3[Get WP Image URL];
            W_ImgMergeInt3 --> W_ImgMergeInt4[Call openaiService.analyzeImageWithGPT4o];
            W_ImgMergeInt4 --> W_ImgMergeInt5[Save AI Desc to Sheet (Col H)];
            W_ImgMergeInt5 --> W_ImgMergeInt6[Use New AI Desc];
            W_ImgMergeInt7 --> W_ImgMergeInt8[Get Appraiser Desc (Param or Col K)];
            W_ImgMergeInt6 --> W_ImgMergeInt8;
            W_ImgMergeInt8 --> W_ImgMergeInt9[Call appraisalService.mergeDescriptions];
            W_ImgMergeInt9 --> W_ImgMergeInt10[Return Result Object];
        end

        W5 --> W_ImgMergeInt1;
    end

    subgraph "Appraisal Service (appraisal.service.js)"
        W3 --> AS1[Start processAppraisal];
        W24 --> AS1;
        W27 --> AS1;
        AS1 --> AS2{Sheet Known?};
        AS2 -- No --> AS3[appraisalFinder.appraisalExists];
        AS2 -- Yes --> AS4[Use Provided Sheet];
        AS3 --> AS4;
        AS4 --> AS5[Update Status: Processing];
        AS5 --> AS6[Get Post ID (Col G)];
        AS6 --> AS7[Call mergeDescriptions];
        AS7 --> AS8[Update Status: Processing, Merging];
        AS8 --> AS9[Call updateWordPress];
        AS9 --> AS10[Save Public URL (Col P)];
        AS10 --> AS11[Update Status: Generating (Log Only)];
        AS11 --> AS12[Call visualize (External Backend)];
        AS12 --> AS13[Update Status: Finalizing];
        AS13 --> AS14[Call finalize];
        AS14 --> AS15[Update Status: Finalizing, PDF Created];
        AS15 --> AS16{From Pending Sheet?};
        AS16 -- Yes --> AS17[Call complete];
        AS16 -- No --> AS_End[End processAppraisal Success];
        AS17 --> AS_End;
        AS_End --> W3;
        AS_End --> W24;
        AS_End --> W27;

        AS1 -- Error --> AS_Fail[Update Status: Failed];
        AS7 -- Error --> AS_Fail;
        AS9 -- Error --> AS_Fail;
        AS12 -- Error --> AS_Fail;
        AS14 -- Error --> AS_Fail;
        AS17 -- Error --> AS_Fail;

        subgraph mergeDescriptions (Internal)
             AS_Merge1[Start mergeDescriptions] --> AS_Merge2{AI Desc Exists (Col H)?};
             AS_Merge2 -- Yes --> AS_Merge7[Use Existing AI Desc];
             AS_Merge2 -- No --> AS_Merge3[Get WP Image URL];
             AS_Merge3 --> AS_Merge4[Call openaiService.analyzeImageWithGPT4o];
             AS_Merge4 --> AS_Merge5[Save AI Desc to Sheet (Col H)];
             AS_Merge5 --> AS_Merge6[Use New AI Desc];
             AS_Merge7 --> AS_Merge8[Call openaiService.mergeDescriptions (Appraiser + AI)];
             AS_Merge6 --> AS_Merge8;
             AS_Merge8 --> AS_Merge9[Save Merged Desc (Col L)];
             AS_Merge9 --> AS_Merge10[Return briefTitle, detailedTitle, mergedDescription];
        end

        AS7 --> AS_Merge1;
        W_ImgMergeInt9 --> AS_Merge1;

        subgraph updateWordPress (Internal)
            AS_WP1[Start updateWordPress] --> AS_WP2[Get Post ID (if needed)];
            AS_WP2 --> AS_WP3[Format Value];
            AS_WP3 --> AS_WP4[Extract Titles from mergeResult];
            AS_WP4 --> AS_WP5[Call wordpressService.updateAppraisalPost];
            AS_WP5 --> AS_WP6[Return publicUrl];
        end

        AS9 --> AS_WP1;
        W11 --> AS_WP1;

        subgraph visualize (Internal)
            AS_Vis1[Start visualize] --> AS_Vis2[Call External Backend: /complete-appraisal-report];
            AS_Vis2 --> AS_Vis3[End visualize Success];
        end

        AS12 --> AS_Vis1;

        subgraph finalize (Internal)
            AS_Fin1[Start finalize] --> AS_Fin2[Call pdfService.generatePDF];
            AS_Fin2 --> AS_Fin3{PDF Links Valid?};
            AS_Fin3 -- Yes --> AS_Fin4[Save PDF Links (Col M, N)];
            AS_Fin3 -- No --> AS_Fin_Fail[Throw Error];
            AS_Fin4 --> AS_Fin5[Get Customer Data (Col D, E)];
            AS_Fin5 --> AS_Fin6[Call emailService.sendAppraisalCompletedEmail];
            AS_Fin6 --> AS_Fin7[Save Email Status (Col Q)];
            AS_Fin7 --> AS_Fin8[End finalize Success];
        end

        AS14 --> AS_Fin1;

        subgraph complete (Internal)
            AS_Comp1[Start complete] --> AS_Comp2[Update Status: Completed];
            AS_Comp2 --> AS_Comp3[Call sheetsService.moveToCompleted];
            AS_Comp3 --> AS_Comp4[End complete Success];
        end

        AS17 --> AS_Comp1;

    end

    subgraph "External Services"
        ES_Sheets[Google Sheets API];
        ES_WP[WordPress REST API];
        ES_OpenAI[OpenAI API (GPT-4o)];
        ES_Email[SendGrid API];
        ES_PDF[PDF Generation Service];
        ES_Secrets[Google Secret Manager];
        ES_ExternalBackend[Appraisals Backend API];
    end

    AS_Merge4 --> ES_OpenAI;
    AS_Merge8 --> ES_OpenAI;
    AS_WP5 --> ES_WP;
    AS_Vis2 --> ES_ExternalBackend;
    AS_Fin2 --> ES_PDF;
    AS_Fin6 --> ES_Email;

    AS3 --> ES_Sheets;
    AS6 --> ES_Sheets;
    AS_Merge2 --> ES_Sheets;
    AS_Merge5 --> ES_Sheets;
    AS_Merge9 --> ES_Sheets;
    AS10 --> ES_Sheets;
    AS_Fin4 --> ES_Sheets;
    AS_Fin5 --> ES_Sheets;
    AS_Fin7 --> ES_Sheets;
    AS_Comp2 --> ES_Sheets;
    AS_Comp3 --> ES_Sheets;
    AS5 --> ES_Sheets;
    AS8 --> ES_Sheets;
    AS13 --> ES_Sheets;
    AS15 --> ES_Sheets;
    AS_Fail --> ES_Sheets;
    W2 --> ES_Sheets;
    W4 --> ES_Sheets;
    W6 --> ES_Sheets;
    W8 --> ES_Sheets;
    W9 --> ES_Sheets;
    W14 --> ES_Sheets;
    W19 --> ES_Sheets;
    W21 --> ES_Sheets;
    W22 --> ES_Sheets;
    W25 --> ES_Sheets;
    W_Fail --> ES_Sheets;
    W_FailPDF --> ES_Sheets;
    W_ImgMergeInt5 --> ES_Sheets;
    W_ImgMergeInt8 --> ES_Sheets;

    W7 --> ES_WP;
    W13 --> ES_WP;
    W_ImgMergeInt3 --> ES_WP;
    AS_Merge3 --> ES_WP;
    AS_WP2 --> ES_WP;

    W_ImgMergeInt4 --> ES_OpenAI;

    worker.initialize --> ES_Secrets;
    worker.initialize --> ES_Sheets;
    worker.initialize --> ES_WP;
    worker.initialize --> ES_OpenAI;
    worker.initialize --> ES_Email;
    worker.initialize --> ES_PDF;
``` 