import Visibility from 'visibilityjs';
import _ from 'lodash';
import { createAlert } from '~/flash';
import axios from '~/lib/utils/axios_utils';
import { convertObjectPropsToCamelCase } from '~/lib/utils/common_utils';
import httpStatusCodes from '~/lib/utils/http_status';
import Poll from '~/lib/utils/poll';
import { capitalizeFirstCharacter } from '~/lib/utils/text_utility';
import { visitUrl, objectToQuery } from '~/lib/utils/url_utility';
import { s__, sprintf } from '~/locale';
import { isProjectImportable } from '../utils';
import { PROVIDERS } from '../../constants';
import * as types from './mutation_types';

let eTagPoll;

const hasRedirectInError = (e) => e?.response?.data?.error?.redirect;
const redirectToUrlInError = (e) => visitUrl(e.response.data.error.redirect);
const tooManyRequests = (e) => e.response.status === httpStatusCodes.TOO_MANY_REQUESTS;
const pathWithParams = ({ path, ...params }) => {
  const filteredParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== ''),
  );
  const queryString = objectToQuery(filteredParams);
  return queryString ? `${path}?${queryString}` : path;
};
const commitPaginationData = ({ state, commit, data }) => {
  const cursorsGitHubResponse = !_.isEmpty(data.pageInfo || {});

  if (state.provider === PROVIDERS.GITHUB && cursorsGitHubResponse) {
    commit(types.SET_PAGE_CURSORS, data.pageInfo);
  } else {
    const nextPage = state.pageInfo.page + 1;
    commit(types.SET_PAGE, nextPage);
  }
};
const paginationParams = ({ state }) => {
  if (state.provider === PROVIDERS.GITHUB && state.pageInfo.endCursor) {
    return { after: state.pageInfo.endCursor };
  }

  const nextPage = state.pageInfo.page + 1;
  return { page: nextPage === 1 ? '' : nextPage.toString() };
};

const isRequired = () => {
  // eslint-disable-next-line @gitlab/require-i18n-strings
  throw new Error('param is required');
};

const clearJobsEtagPoll = () => {
  eTagPoll = null;
};

const stopJobsPolling = () => {
  if (eTagPoll) eTagPoll.stop();
};

const restartJobsPolling = () => {
  if (eTagPoll) eTagPoll.restart();
};

const setImportTarget = ({ commit }, { repoId, importTarget }) =>
  commit(types.SET_IMPORT_TARGET, { repoId, importTarget });

const importAll = ({ state, dispatch }, config = {}) => {
  return Promise.all(
    state.repositories.filter(isProjectImportable).map((r) =>
      dispatch('fetchImport', {
        repoId: r.importSource.id,
        optionalStages: config?.optionalStages,
      }),
    ),
  );
};

const fetchReposFactory = ({ reposPath = isRequired() }) => ({ state, commit }) => {
  commit(types.REQUEST_REPOS);

  const { provider, filter } = state;

  return axios
    .get(
      pathWithParams({
        path: reposPath,
        filter: filter ?? '',
        ...paginationParams({ state }),
      }),
    )
    .then(({ data }) => {
      const camelData = convertObjectPropsToCamelCase(data, { deep: true });
      commitPaginationData({ state, commit, data: camelData });
      commit(types.RECEIVE_REPOS_SUCCESS, camelData);
    })
    .catch((e) => {
      if (hasRedirectInError(e)) {
        redirectToUrlInError(e);
      } else if (tooManyRequests(e)) {
        createAlert({
          message: sprintf(s__('ImportProjects|%{provider} rate limit exceeded. Try again later'), {
            provider: capitalizeFirstCharacter(provider),
          }),
        });

        commit(types.RECEIVE_REPOS_ERROR);
      } else {
        createAlert({
          message: sprintf(s__('ImportProjects|Requesting your %{provider} repositories failed'), {
            provider,
          }),
        });

        commit(types.RECEIVE_REPOS_ERROR);
      }
    });
};

const fetchImportFactory = (importPath = isRequired()) => (
  { state, commit, getters },
  { repoId, optionalStages },
) => {
  const { ciCdOnly } = state;
  const importTarget = getters.getImportTarget(repoId);

  commit(types.REQUEST_IMPORT, { repoId, importTarget });

  const { newName, targetNamespace } = importTarget;
  return axios
    .post(importPath, {
      repo_id: repoId,
      ci_cd_only: ciCdOnly,
      new_name: newName,
      target_namespace: targetNamespace,
      ...(Object.keys(optionalStages).length ? { optional_stages: optionalStages } : {}),
    })
    .then(({ data }) => {
      commit(types.RECEIVE_IMPORT_SUCCESS, {
        importedProject: convertObjectPropsToCamelCase(data, { deep: true }),
        repoId,
      });
    })
    .catch((e) => {
      const serverErrorMessage = e?.response?.data?.errors;
      const flashMessage = serverErrorMessage
        ? sprintf(
            s__('ImportProjects|Importing the project failed: %{reason}'),
            {
              reason: serverErrorMessage,
            },
            false,
          )
        : s__('ImportProjects|Importing the project failed');

      createAlert({
        message: flashMessage,
      });

      commit(types.RECEIVE_IMPORT_ERROR, repoId);
    });
};

export const fetchJobsFactory = (jobsPath = isRequired()) => ({ state, commit, dispatch }) => {
  if (eTagPoll) {
    stopJobsPolling();
    clearJobsEtagPoll();
  }

  eTagPoll = new Poll({
    resource: {
      fetchJobs: () => axios.get(pathWithParams({ path: jobsPath, filter: state.filter })),
    },
    method: 'fetchJobs',
    successCallback: ({ data }) =>
      commit(types.RECEIVE_JOBS_SUCCESS, convertObjectPropsToCamelCase(data, { deep: true })),
    errorCallback: (e) => {
      if (hasRedirectInError(e)) {
        redirectToUrlInError(e);
      } else {
        createAlert({
          message: s__('ImportProjects|Update of imported projects with realtime changes failed'),
        });
      }
    },
  });

  if (!Visibility.hidden()) {
    eTagPoll.makeRequest();
  }

  Visibility.change(() => {
    if (!Visibility.hidden()) {
      dispatch('restartJobsPolling');
    } else {
      dispatch('stopJobsPolling');
    }
  });
};

const setFilter = ({ commit, dispatch }, filter) => {
  commit(types.SET_FILTER, filter);

  return dispatch('fetchRepos');
};

export default ({ endpoints = isRequired() }) => ({
  clearJobsEtagPoll,
  stopJobsPolling,
  restartJobsPolling,
  setFilter,
  setImportTarget,
  importAll,
  fetchRepos: fetchReposFactory({ reposPath: endpoints.reposPath }),
  fetchImport: fetchImportFactory(endpoints.importPath),
  fetchJobs: fetchJobsFactory(endpoints.jobsPath),
});
