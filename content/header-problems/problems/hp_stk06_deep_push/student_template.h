#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::deep_push(size_t k, const T &element)
{
  // Your code here
}

template <typename T>
const T &CP::stack<T>::top() const
{
  // You MAY need to edit this function
  return mData[mSize - 1];
}

template <typename T>
void CP::stack<T>::push(const T &element)
{
  // You MAY need to edit this function
  ensureCapacity(mSize + 1);
  mData[mSize] = element;
  mSize++;
}

template <typename T>
void CP::stack<T>::pop()
{
  // You MAY need to edit this function
  if (mSize > 0)
    mSize--;
}

#endif
