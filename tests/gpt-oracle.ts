import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { GptOracle } from "../target/types/gpt_oracle";
import { init as initTuktuk, taskQueueAuthorityKey } from "@helium/tuktuk-sdk";
const ORACLE_PROGRAM_ID = new PublicKey(
  "LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab"
);
const TUKTUK_PROGRAM_ID = new PublicKey(
  "tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA"
);
const TASK_QUEUE = new PublicKey(
  "CJv1jLvFSLsV7X1UGq6bHr6XHacbJAfq7Tio8iqpEK6b"
);
describe("gpt-oracle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const program = anchor.workspace.gptOracle as Program<GptOracle>;
  const getCounterPda = (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("counter")],
      ORACLE_PROGRAM_ID
    );
  const getAgentPda = (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), wallet.publicKey.toBuffer()],
      program.programId
    );
  const getLlmContextPda = (count: number): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("test-context"),
        new Uint8Array(new Uint32Array([count]).buffer),
      ],
      ORACLE_PROGRAM_ID
    );
  const getInteractionPda = (context: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("interaction"),
        wallet.publicKey.toBuffer(),
        context.toBuffer(),
      ],
      ORACLE_PROGRAM_ID
    );
  const getQueueAuthorityPda = (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("queue_authority")],
      program.programId
    );
  describe("Initialization", () => {
    it("Initializes the Agent and LLM context if not already created", async () => {
      const [counterPda] = getCounterPda();
      const [agentPda] = getAgentPda();
      const agentInfo = await provider.connection.getAccountInfo(agentPda);
      if (agentInfo) {
        console.log("  ⏭  Agent already initialized – skipping.");
        return;
      }
      const counterInfo = await provider.connection.getAccountInfo(counterPda);
      console.log("  [DEBUG] counterPda:", counterPda.toBase58());
      console.log("  [DEBUG] counterInfo:", counterInfo);
      if (!counterInfo) throw new Error("Oracle counter account not found. Expected PDA: " + counterPda.toBase58());
      const count = counterInfo.data.readUInt32LE(8); 
      const [llmContextPda] = getLlmContextPda(count);
      const tx = await program.methods
        .initialize()
        .accountsPartial({
          payer: wallet.publicKey,
          agent: agentPda,
          counter: counterPda,
          llmContext: llmContextPda,
          oracleProgram: ORACLE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("  ✅ Initialize tx:", tx);
    });
  });
  describe("Interaction", () => {
    it("Sends a prompt directly to the LLM via interact_with_llm", async () => {
      const [agentPda] = getAgentPda();
      const agentAccount = await program.account.agent.fetch(agentPda);
      const llmContextPda = agentAccount.context;
      const [interactionPda] = getInteractionPda(llmContextPda);
      const tx = await program.methods
        .interactWithLlm()
        .accountsPartial({
          payer: wallet.publicKey,
          interaction: interactionPda,
          agent: agentPda,
          contextAccount: llmContextPda,
          oracleProgram: ORACLE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("  ✅ Interact tx:", tx);
      console.log(
        "     Monitor the Oracle relayer for the GPT callback on devnet."
      );
    });
  });
  describe("Schedule", () => {
    it("Registers the queue authority (once) then schedules interact_with_llm", async () => {
      const tuktukIdl = require("./tuktuk.json");
      tuktukIdl.address = TUKTUK_PROGRAM_ID.toBase58();
      const tuktukProgram = new Program(tuktukIdl, provider);
      const [agentPda] = getAgentPda();
      const [queueAuthority] = getQueueAuthorityPda();
      console.log("  Queue authority:", queueAuthority.toBase58());
      const agentAccount = await program.account.agent.fetch(agentPda);
      const llmContextPda = agentAccount.context;
      const [interactionPda] = getInteractionPda(llmContextPda);
      const tqAuthPda = taskQueueAuthorityKey(TASK_QUEUE, queueAuthority)[0];
      const tqAuthInfo = await provider.connection.getAccountInfo(tqAuthPda);
      if (!tqAuthInfo) {
        console.log("  Registering queue authority with TukTuk...");
        console.log("  Wallet PK:", wallet.publicKey.toBase58());
        try {
          const ix = await tuktukProgram.methods
            .addQueueAuthorityV0()
            .accounts({
              payer: wallet.publicKey,
              updateAuthority: wallet.publicKey,
              queueAuthority,
              taskQueue: TASK_QUEUE,
            })
            .instruction();
          console.log("    Generated ix program:", ix.programId.toBase58());
          console.log("    Generated ix keys:");
          ix.keys.forEach(k => console.log(`      ${k.pubkey.toBase58()} (signer: ${k.isSigner}, writable: ${k.isWritable})`));
          
          const regTx = await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), [wallet.payer]);
          console.log("    Register TX:", regTx);
        } catch (e: any) {
          console.dir(e, { depth: null });
          if (e.message) console.log("ERROR MESSAGE:", e.message);
          throw e;
        }
      } else {
        console.log("  ⏭  Queue authority already registered.");
      }
      const tqRaw = (await tuktukProgram.account.taskQueueV0.fetch(
        TASK_QUEUE
      )) as any;
      let taskId = 0;
      outer: for (let i = 0; i < tqRaw.taskBitmap.length; i++) {
        if (tqRaw.taskBitmap[i] !== 0xff) {
          for (let bit = 0; bit < 8; bit++) {
            if ((tqRaw.taskBitmap[i] & (1 << bit)) === 0) {
              taskId = i * 8 + bit;
              break outer;
            }
          }
        }
      }
      const taskIdBuf = Buffer.alloc(2);
      taskIdBuf.writeUInt16LE(taskId);
      const [taskAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("task"), TASK_QUEUE.toBuffer(), taskIdBuf],
        TUKTUK_PROGRAM_ID
      );
      const [tqAuthorityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("task_queue_authority"),
          TASK_QUEUE.toBuffer(),
          queueAuthority.toBuffer(),
        ],
        TUKTUK_PROGRAM_ID
      );
      console.log("  task_id:", taskId);
      console.log("  task:   ", taskAccount.toBase58());
      const ix = await program.methods
        .schedule(taskId)
        .accountsPartial({
          payer: wallet.publicKey,
          interaction: interactionPda,
          agent: agentPda,
          contextAccount: llmContextPda,
          taskQueue: TASK_QUEUE,
          taskQueueAuthority: tqAuthorityPda,
          task: taskAccount,
          queueAuthority,
          tuktukProgram: TUKTUK_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      
      try {
        const tx = await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), [wallet.payer]);
        console.log("  ✅ Schedule tx:", tx);
      } catch (e: any) {
        console.dir(e, { depth: null });
        if (e.message) console.log("ERROR MESSAGE:", e.message);
        throw e;
      }
      console.log(
        "\n  Explorer:",
        `https://explorer.solana.com/address/${program.programId.toBase58()}?cluster=devnet`
      );
    });
  });
});
