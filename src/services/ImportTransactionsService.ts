import { getRepository, getCustomRepository, In } from 'typeorm';

import Transaction from '../models/Transaction';
import Category from '../models/Category';

import csvParse from 'csv-parse';
import fs from 'fs';
import path from 'path';

import uploadConfig from '../config/upload';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface Request {
  filename: string;
}

interface CSVTransaction {
  title: string;
  type: "income" | "outcome";
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute({ filename }:Request): Promise<Transaction[]> {

    const categoriesRepository = getRepository(Category);
    const transactionsRepository = getCustomRepository(TransactionsRepository);

    //Caminho destino do arquivo
    const filePath = path.join(uploadConfig.directory, filename);

    //Lendo o arquivo csv
    const readCSVStream = fs.createReadStream(filePath);

    //Determinando que iremos pegar os dados a partir da segunda linha
    const parseStream = csvParse({
      from_line: 2,
    });

    //Fica lendo o arquivo e sempre que tiver registro vai armazenar aqui
    const parseCSV = readCSVStream.pipe(parseStream);

    const transactions: CSVTransaction[] = [];
    const categories: string[] = [];

    //Retira os dados nomeando cada registro do array
    parseCSV.on('data', async line => {
      const [ title, type, value, category ] = line.map((celula:string) =>
        celula.trim()
      );

      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, type, value, category });

    });

    //finaliza a leitura do arquivo
    await new Promise(resolve => {
      parseCSV.on('end', resolve);
    });

    //localiza as categorias já cadastradas passando o [] das categorias
    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories)
      }
    });

    //Retorna somente os títulos das categorias existentes
    const existentCategoriesTitles = existentCategories
      .map((category:Category) => category.title);

    //Filtra as categorias ainda não cadastradas e retira os duplicados
    const addCategoryTitles = categories
      .filter(category => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    //Criar as categorias
    const newCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      }))
    );

    //Cadastrar as categorias no banco de dados
    await categoriesRepository.save(newCategories);

    //Concatenando as categorias já existentes com as novas
    const finalCategories = [...newCategories, ...existentCategories];

    //Criando a transação
    const createdTransactions = transactionsRepository.create(
      transactions.map(transaction => ({
          title: transaction.title,
          type: transaction.type,
          value: transaction.value,
          category: finalCategories
            .find(category => category.title === transaction.category)
        }),
      )
    );

    //Salvando a transação no banco de dados
    await transactionsRepository.save(createdTransactions);

    //Excluindo o arquivo csv
    await fs.promises.unlink(filePath);

    return createdTransactions;

  }
}

export default ImportTransactionsService;
