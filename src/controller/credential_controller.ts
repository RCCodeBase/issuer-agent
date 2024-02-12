import express from 'express';

import * as Cord from '@cord.network/sdk';

import {
  issuerDid,
  authorIdentity,
  addDelegateAsRegistryDelegate,
  issuerKeysProperty,
  delegateDid,
  delegateSpaceAuth,
  delegateKeysProperty,
} from '../init';

import { getConnection } from 'typeorm';
import { Cred } from '../entity/Cred';
const { CHAIN_SPACE_ID, CHAIN_SPACE_AUTH } = process.env;

export async function issueVD(req: express.Request, res: express.Response) {
  if (!authorIdentity) {
    await addDelegateAsRegistryDelegate();
  }

  try {
    const newCredContent = req.body;
    newCredContent.issuanceDate = new Date().toISOString();
    const serializedCred = Cord.Utils.Crypto.encodeObjectAsStr(newCredContent);
    const credHash = Cord.Utils.Crypto.hashStr(serializedCred);

    const statementEntry = Cord.Statement.buildFromProperties(
      credHash,
      CHAIN_SPACE_ID as `space:cord:${string}`,
      issuerDid.uri,
      req.params.id as `schema:cord:${string}`
    );

    console.dir(statementEntry, {
      depth: null,
      colors: true,
    });

    const statement = await Cord.Statement.dispatchRegisterToChain(
      statementEntry,
      issuerDid.uri,
      authorIdentity,
      CHAIN_SPACE_AUTH as `auth:cord:${string}`,
      async ({ data }) => ({
        signature: issuerKeysProperty.authentication.sign(data),
        keyType: issuerKeysProperty.authentication.type,
      })
    );

    console.log(`✅ Statement element registered - ${statement}`);

    const cred = new Cred();
    cred.schemaId = req.params.id;
    cred.identifier = statement;
    cred.active = true;
    cred.fromDid = issuerDid.uri;
    cred.credHash = credHash;
    cred.newCredContent = newCredContent;
    cred.credentialEntry = statementEntry;

    if (statement) {
      await getConnection().manager.save(cred);
      return res
        .status(200)
        .json({ result: 'success', identifier: cred.identifier });
    } else {
      return res.status(400).json({ error: 'Credential not issued' });
    }
  } catch (err) {
    console.log('Error: ', err);
    throw new Error('Error in VD issuence');
  }

  // const url: any = WALLET_URL;

  // if (url && data.type) {
  //   await fetch(`${url}/message/${holderDidUri}`, {
  //     body: JSON.stringify({
  //       id: data.id,
  //       type: data.type,
  //       fromDid: issuerDid.uri,
  //       toDid: holderDidUri,
  //       message: documents,
  //     }),
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //     },
  //   })
  //     .then((resp) => resp.json())
  //     .then(() => console.log('Saved to db'))
  //     .catch((error) => {
  //       console.error(error);
  //       return res.json({ result: 'VC not issued' });
  //     });
  // }

  // return res.status(200).json({ result: 'SUCCESS' });
}

export async function getCredById(req: express.Request, res: express.Response) {
  try {
    const cred = await getConnection()
      .getRepository(Cred)
      .findOne({ identifier: req.params.id });

    if (!cred) {
      return res.status(400).json({ error: 'Cred not found' });
    }

    return res.status(200).json({ credential: cred });
  } catch (error) {
    console.log('Error: ', error);
    throw new Error('Error in cred fetch');
  }
}

export async function updateCred(req: express.Request, res: express.Response) {
  const data = req.body;

  if (!data.property || typeof data.property !== 'object') {
    return res.status(400).json({
      error: '"property" is a required field and should be an object',
    });
  }

  try {
    const cred = await getConnection()
      .getRepository(Cred)
      .findOne({ identifier: req.params.id });

    if (!cred) {
      return res.status(400).json({ error: 'Cred not found' });
    }

    console.log(`\n❄️  Statement Updation `);
    let updateCredContent = cred.newCredContent;
    updateCredContent.issuanceDate = new Date().toISOString();
    updateCredContent.property = data.property;
    const serializedUpCred =
      Cord.Utils.Crypto.encodeObjectAsStr(updateCredContent);
    const upCredHash = Cord.Utils.Crypto.hashStr(serializedUpCred);

    const updatedStatementEntry = Cord.Statement.buildFromUpdateProperties(
      cred.credentialEntry.elementUri,
      upCredHash,
      CHAIN_SPACE_ID as `space:cord:${string}`,
      delegateDid.uri
    );

    console.dir(updatedStatementEntry, {
      depth: null,
      colors: true,
    });

    const updatedStatement = await Cord.Statement.dispatchUpdateToChain(
      updatedStatementEntry,
      delegateDid.uri,
      authorIdentity,
      delegateSpaceAuth as Cord.AuthorizationUri,
      async ({ data }) => ({
        signature: delegateKeysProperty.authentication.sign(data),
        keyType: delegateKeysProperty.authentication.type,
      })
    );
    console.log(`✅ Statement element registered - ${updatedStatement}`);

    if (updatedStatement) {
      cred.identifier = updatedStatement;
      cred.credHash = upCredHash;
      cred.newCredContent = updateCredContent;
      cred.credentialEntry = updatedStatementEntry;

      await getConnection().manager.save(cred);

      console.log('\n✅ Statement updated!');

      return res.status(200).json({
        result: 'Updated successufully',
        identifier: cred.identifier,
      });
    }
    return res.status(400).json({ error: 'Document not updated' });
  } catch (error) {
    console.log('error: ', error);
    throw new Error('Error in updating document');
  }
}

export async function revokeCred(req: express.Request, res: express.Response) {
  try {
    const cred = await getConnection()
      .getRepository(Cred)
      .findOne({ identifier: req.params.id });

    if (!cred) {
      return res.status(400).json({ error: 'Invalid identifier' });
    }

    await Cord.Statement.dispatchRevokeToChain(
      cred.credentialEntry.elementUri,
      delegateDid.uri,
      authorIdentity,
      delegateSpaceAuth as Cord.AuthorizationUri,
      async ({ data }) => ({
        signature: delegateKeysProperty.authentication.sign(data),
        keyType: delegateKeysProperty.authentication.type,
      })
    );

    cred.active = false;

    await getConnection().manager.save(cred);

    console.log(`✅ Statement revoked!`);

    return res.status(200).json({ result: 'Statement revoked Successfully' });
  } catch (error) {
    console.log('err: ', error);
    return res.status(400).json({ err: error });
  }
}
