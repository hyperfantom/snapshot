import Vue from 'vue';
import { getInstance } from '@bonustrack/lock/plugins/vue';
import { getScores } from '@bonustrack/snapshot.js/src/utils';
import client from '@/helpers/client';
import ipfs from '@/helpers/ipfs';
import getProvider from '@/helpers/provider';
import { formatProposal, formatProposals } from '@/helpers/utils';
import { getBlockNumber, signMessage } from '@/helpers/web3';
import { version } from '@/../package.json';

const state = {
  init: false,
  loading: false,
  spaces: {}
};

const mutations = {
  SET(_state, payload) {
    Object.keys(payload).forEach(key => {
      Vue.set(_state, key, payload[key]);
    });
  },
  SEND_REQUEST() {
    console.debug('SEND_REQUEST');
  },
  SEND_SUCCESS() {
    console.debug('SEND_SUCCESS');
  },
  SEND_FAILURE(_state, payload) {
    console.debug('SEND_FAILURE', payload);
  },
  GET_PROPOSALS_REQUEST() {
    console.debug('GET_PROPOSALS_REQUEST');
  },
  GET_PROPOSALS_SUCCESS() {
    console.debug('GET_PROPOSALS_SUCCESS');
  },
  GET_PROPOSALS_FAILURE(_state, payload) {
    console.debug('GET_PROPOSALS_FAILURE', payload);
  },
  GET_PROPOSAL_REQUEST() {
    console.debug('GET_PROPOSAL_REQUEST');
  },
  GET_PROPOSAL_SUCCESS() {
    console.debug('GET_PROPOSAL_SUCCESS');
  },
  GET_PROPOSAL_FAILURE(_state, payload) {
    console.debug('GET_PROPOSAL_FAILURE', payload);
  },
  GET_POWER_REQUEST() {
    console.debug('GET_POWER_REQUEST');
  },
  GET_POWER_SUCCESS() {
    console.debug('GET_POWER_SUCCESS');
  },
  GET_POWER_FAILURE(_state, payload) {
    console.debug('GET_POWER_FAILURE', payload);
  }
};

const actions = {
  init: async ({ commit, dispatch, rootState }) => {
    commit('SET', { loading: true });
    const connector = await Vue.prototype.$auth.getConnector();
    if (connector) {
      await dispatch('login', connector);
    } else {
      commit('HANDLE_CHAIN_CHANGED', 1);
    }
    const init = await Promise.all([
      dispatch('getSpaces'),
      getBlockNumber(getProvider(rootState.web3.network.chainId))
    ]);
    commit('GET_BLOCK_SUCCESS', init[1]);
    commit('SET', { loading: false, init: true });
  },
  loading: ({ commit }, payload) => {
    commit('SET', { loading: payload });
  },
  getSpaces: async ({ commit }) => {
    const spaces = {};
    commit('SET', { spaces });
    return spaces;
    /*
    const spaces: any = await client.request('spaces');
    if (config.env !== 'master') {
      try {
        const namespace = registry[0];
        const content = await resolveContent(getProvider(1), namespace);
        const space = await fetch(
          `https://ipfs.fleek.co/ipns/${content.decoded}`
        ).then(res => res.json());
        console.log('Space', space);
        space.key = namespace;
        space.token = namespace;
        space.address = namespace;
        spaces[namespace] = space;
      } catch (e) {
        console.log(e);
      }
    }
    commit('SET', { spaces });
    return spaces;
    */
  },
  send: async ({ commit, dispatch, rootState }, { token, type, payload }) => {
    const auth = getInstance();
    commit('SEND_REQUEST');
    try {
      const msg: any = {
        address: rootState.web3.account,
        msg: JSON.stringify({
          version,
          timestamp: (Date.now() / 1e3).toFixed(),
          token,
          type,
          payload
        })
      };
      msg.sig = await signMessage(auth.web3, msg.msg);
      const result = await client.request('message', msg);
      commit('SEND_SUCCESS');
      dispatch('notify', ['green', `Your ${type} is in!`]);
      return result;
    } catch (e) {
      commit('SEND_FAILURE', e);
      const errorMessage =
        e && e.error_description
          ? `Oops, ${e.error_description}`
          : 'Oops, something went wrong!';
      dispatch('notify', ['red', errorMessage]);
      return;
    }
  },
  getProposals: async ({ commit }, space) => {
    commit('GET_PROPOSALS_REQUEST');
    try {
      let proposals: any = await client.request(`${space.address}/proposals`);
      if (proposals) {
        const scores: any = await getScores(
          space.strategies,
          space.chainId,
          getProvider(space.chainId),
          Object.values(proposals).map((proposal: any) => proposal.address)
        );
        proposals = Object.fromEntries(
          Object.entries(proposals).map((proposal: any) => {
            proposal[1].score = scores.reduce(
              (a, b) => a + b[proposal[1].address],
              0
            );
            return [proposal[0], proposal[1]];
          })
        );
      }
      commit('GET_PROPOSALS_SUCCESS');
      return formatProposals(proposals);
    } catch (e) {
      commit('GET_PROPOSALS_FAILURE', e);
    }
  },
  getProposal: async ({ commit, rootState }, payload) => {
    commit('GET_PROPOSAL_REQUEST');
    try {
      const result: any = {};
      const [proposal, votes] = await Promise.all([
        ipfs.get(payload.id),
        client.request(`${payload.space.address}/proposal/${payload.id}`)
      ]);
      result.proposal = formatProposal(proposal);
      result.proposal.ipfsHash = payload.id;
      result.votes = votes;
      const { snapshot } = result.proposal.msg.payload;
      const blockTag =
        snapshot > rootState.web3.blockNumber ? 'latest' : parseInt(snapshot);
      const scores: any = await getScores(
        payload.space.strategies,
        payload.space.chainId,
        getProvider(payload.space.chainId),
        Object.keys(result.votes),
        // @ts-ignore
        blockTag
      );
      console.log('Scores', scores);
      result.votes = Object.fromEntries(
        Object.entries(result.votes)
          .map((vote: any) => {
            vote[1].scores = payload.space.strategies.map(
              (strategy, i) => scores[i][vote[1].address] || 0
            );
            vote[1].balance = vote[1].scores.reduce((a, b: any) => a + b, 0);
            return vote;
          })
          .sort((a, b) => b[1].balance - a[1].balance)
          .filter(vote => vote[1].balance > 0)
      );
      result.results = {
        totalVotes: result.proposal.msg.payload.choices.map(
          (choice, i) =>
            Object.values(result.votes).filter(
              (vote: any) => vote.msg.payload.choice === i + 1
            ).length
        ),
        totalBalances: result.proposal.msg.payload.choices.map((choice, i) =>
          Object.values(result.votes)
            .filter((vote: any) => vote.msg.payload.choice === i + 1)
            .reduce((a, b: any) => a + b.balance, 0)
        ),
        totalScores: result.proposal.msg.payload.choices.map((choice, i) =>
          payload.space.strategies.map((strategy, sI) =>
            Object.values(result.votes)
              .filter((vote: any) => vote.msg.payload.choice === i + 1)
              .reduce((a, b: any) => a + b.scores[sI], 0)
          )
        ),
        totalVotesBalances: Object.values(result.votes).reduce(
          (a, b: any) => a + b.balance,
          0
        )
      };
      commit('GET_PROPOSAL_SUCCESS');
      return result;
    } catch (e) {
      commit('GET_PROPOSAL_FAILURE', e);
    }
  },
  getPower: async ({ commit, rootState }, { space, address, snapshot }) => {
    commit('GET_POWER_REQUEST');
    try {
      const blockTag =
        snapshot > rootState.web3.blockNumber ? 'latest' : parseInt(snapshot);
      let scores: any = await getScores(
        space.strategies,
        space.chainId,
        getProvider(space.chainId),
        [address],
        // @ts-ignore
        blockTag
      );
      scores = scores.map((score: any) =>
        Object.values(score).reduce((a, b: any) => a + b, 0)
      );
      commit('GET_POWER_SUCCESS');
      return {
        scores,
        totalScore: scores.reduce((a, b: any) => a + b, 0)
      };
    } catch (e) {
      commit('GET_POWER_FAILURE', e);
    }
  }
};

export default {
  state,
  mutations,
  actions
};
