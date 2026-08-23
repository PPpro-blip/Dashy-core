/// <reference types="node" />

/**
 * TEMPORARY TEST SCRIPT - DELETE AFTER USE
 * 
 * Tests RAG retrieval end-to-end using the existing lib/rag/retrieve.ts
 * 
 * Usage:
 *   npx tsx scripts/test-retrieval.ts
 * 
 * Required environment variables:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service-role key
 *   TEST_ACCESS_TOKEN - Valid Supabase Auth access token for test user
 *   TEST_USER_ID - User ID to search for (from the access token)
 * 
 * IMPORTANT: 
 * - This file is temporary and should be deleted after testing
 * - Never commit this file or credentials to version control
 */

import { retrieveContext, RAGSearchOptions } from "../lib/rag/retrieve";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_ACCESS_TOKEN = process.env.TEST_ACCESS_TOKEN;
const TEST_USER_ID = process.env.TEST_USER_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TEST_ACCESS_TOKEN || !TEST_USER_ID) {
  console.error("Missing required environment variables:");
  console.error("  SUPABASE_URL:", !!SUPABASE_URL ? "✓" : "✗");
  console.error("  SUPABASE_SERVICE_ROLE_KEY:", !!SUPABASE_SERVICE_ROLE_KEY ? "✓" : "✗");
  console.error("  TEST_ACCESS_TOKEN:", !!TEST_ACCESS_TOKEN ? "✓" : "✗");
  console.error("  TEST_USER_ID:", !!TEST_USER_ID ? "✓" : "✗");
  process.exit(1);
}

async function testRetrieval() {
  try {
    const query = "What is DashyCore?";
    console.log("=".repeat(60));
    console.log("RAG RETRIEVAL TEST");
    console.log("=".repeat(60));
    console.log("\nQuery:", query);
    console.log("User ID:", TEST_USER_ID);
    console.log("\nSearching for relevant chunks...\n");

    const options: RAGSearchOptions = {
      userId: TEST_USER_ID!,
      query: query,
      topK: 3,
      similarityThreshold: 0.5,
    };

    const results = await retrieveContext(options, {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      JINA_API_KEY: process.env.JINA_API_KEY as string | undefined,
    });

    if (results.length === 0) {
      console.log("No results found. This could mean:");
      console.log("  - No documents have been ingested for this user");
      console.log("  - No chunks match the query with similarity >= 0.5");
      console.log("  - JINA_API_KEY is missing or invalid");
      return;
    }

    console.log(`Found ${results.length} result(s):\n`);

    results.forEach((result, index) => {
      console.log(`--- Result ${index + 1} ---`);
      console.log(`Document ID: ${result.metadata.documentId}`);
      console.log(`Chunk Index: ${result.metadata.chunkIndex}`);
      console.log(`Similarity: ${result.metadata.similarity.toFixed(4)}`);
      console.log(`Title: ${result.metadata.title || 'N/A'}`);
      console.log(`Source Type: ${result.metadata.sourceType || 'N/A'}`);
      console.log(`\nContent:\n${result.content}\n`);
    });

    console.log("=".repeat(60));
    console.log("RETRIEVAL TEST SUCCESSFUL");
    console.log("=".repeat(60));
    
  } catch (error) {
    console.error("\n[ERROR] Retrieval test failed:", error);
    process.exit(1);
  }
}

testRetrieval();