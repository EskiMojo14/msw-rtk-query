/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EntityState } from "@reduxjs/toolkit";
import { createEntityAdapter } from "@reduxjs/toolkit";
import type {
  BaseQueryFn,
  CoreModule,
  EndpointDefinitions,
  Api,
  Module,
} from "@reduxjs/toolkit/query";
import {
  buildCreateApi,
  coreModule,
  fetchBaseQuery,
} from "@reduxjs/toolkit/query";
import type {
  HttpHandler,
  HttpResponseResolver,
  Path,
  DefaultBodyType,
  PathParams,
  JsonBodyType,
} from "msw";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const mswModuleName = Symbol();
export type MswModule = typeof mswModuleName;

interface MockOptions {
  path: Path;
  method: keyof typeof http;
}

interface EndpointMock {
  mock: <
    Params extends PathParams<keyof Params> = PathParams,
    RequestBodyType extends DefaultBodyType = DefaultBodyType,
    ResponseBodyType extends JsonBodyType = JsonBodyType,
  >(
    resolver: HttpResponseResolver<Params, RequestBodyType, ResponseBodyType>,
  ) => HttpHandler;
}

declare module "@reduxjs/toolkit/query" {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  export interface QueryExtraOptions<
    TagTypes extends string,
    ResultType,
    QueryArg,
    BaseQuery extends BaseQueryFn,
    ReducerPath extends string = string,
  > {
    mock?: MockOptions;
  }

  export interface MutationExtraOptions<
    TagTypes extends string,
    ResultType,
    QueryArg,
    BaseQuery extends BaseQueryFn,
    ReducerPath extends string = string,
  > {
    mock?: MockOptions;
  }

  export interface InfiniteQueryExtraOptions<
    TagTypes extends string,
    ResultType,
    QueryArg,
    PageParam,
    BaseQuery extends BaseQueryFn,
    ReducerPath extends string = string,
  > {
    mock?: MockOptions;
  }

  export interface ApiModules<
    BaseQuery extends BaseQueryFn,
    Definitions extends EndpointDefinitions,
    ReducerPath extends string,
    TagTypes extends string,
  > {
    [mswModuleName]: {
      endpoints: {
        [K in keyof Definitions]: EndpointMock;
      };
    };
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}

export const mswModule = (): Module<MswModule> => ({
  name: mswModuleName,
  init(api) {
    return {
      injectEndpoint(endpointName, definition) {
        const anyApi = api as any as Api<
          any,
          Record<string, any>,
          string,
          string,
          MswModule | CoreModule
        >;
        const endpoint = anyApi.endpoints[endpointName];
        if (!endpoint)
          throw new Error("core module should be before mswModule");

        endpoint.mock = (resolver) => {
          if (!definition.mock)
            throw new Error(
              "mock can only be called with endpoints that have mock options",
            );
          return http[definition.mock.method](definition.mock.path, resolver);
        };
      },
    };
  },
});

export const createApi = buildCreateApi(coreModule(), mswModule());

// example

const server = setupServer();

interface Pokemon {
  id: number;
  name: string;
}

const pokemonAdapter = createEntityAdapter<Pokemon>();

const pokemonApi = createApi({
  baseQuery: fetchBaseQuery({ baseUrl: "https://pokeapi.co/api/v2/" }),
  endpoints: (builder) => ({
    getPokemon: builder.query<EntityState<Pokemon, Pokemon["id"]>, void>({
      query: () => "/pokemon",
      transformResponse: (pokemon: Array<Pokemon>) =>
        pokemonAdapter.getInitialState(undefined, pokemon),
      mock: {
        path: "/pokemon",
        method: "get",
      },
    }),
    getPokemonByName: builder.query<Pokemon, string>({
      query: (name) => `/pokemon/${name}`,
      mock: {
        path: "/pokemon/:name",
        method: "get",
      },
    }),
    updatePokemon: builder.mutation<
      Pokemon,
      { name: string; body: Partial<Pokemon> }
    >({
      query: ({ name, body }) => ({
        url: `/pokemon/${name}`,
        method: "PATCH",
        body,
      }),
      mock: {
        path: "/pokemon/:name",
        method: "patch",
      },
    }),
  }),
});

server.use(
  pokemonApi.endpoints.getPokemon.mock<{}, never, Array<Pokemon>>(() =>
    HttpResponse.json([
      {
        id: 1,
        name: "bulbasaur",
      },
    ]),
  ),
  pokemonApi.endpoints.getPokemonByName.mock<{ name: string }, never, Pokemon>(
    ({ params }) =>
      HttpResponse.json({
        id: 1,
        name: params.name,
      }),
  ),
  pokemonApi.endpoints.updatePokemon.mock<
    { name: string },
    Partial<Pokemon>,
    Pokemon
  >(async ({ params, request }) => {
    const patch = await request.json();
    return HttpResponse.json({
      id: 1,
      name: params.name,
      ...patch,
    });
  }),
);
