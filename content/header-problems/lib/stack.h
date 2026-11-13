#ifndef _CP_STACK_INCLUDED_
#define _CP_STACK_INCLUDED_

#include <iostream>
#include <stdexcept>

namespace CP
{

  template <typename T>
  class stack
  {
  protected:
    T *mData;
    size_t mCap;
    size_t mSize;
    int aux;

    void expand(size_t capacity)
    {
      T *arr = new T[capacity]();
      for (size_t i = 0; i < mSize; i++)
      {
        arr[i] = mData[i];
      }
      delete[] mData;
      mData = arr;
      mCap = capacity;
    }

    void ensureCapacity(size_t capacity)
    {
      if (capacity > mCap)
      {
        size_t s = (capacity > 2 * mCap) ? capacity : 2 * mCap;
        expand(s);
      }
    }

  public:
    //-------------- constructor ----------

    // copy constructor
    stack(const stack<T> &a)
        : mData(new T[a.mCap]()), mCap(a.mCap), mSize(a.mSize), aux(a.aux)
    {
      for (size_t i = 0; i < a.mCap; i++)
      {
        mData[i] = a.mData[i];
      }
    }

    // default constructor
    stack() : mData(new T[1]()), mCap(1), mSize(0), aux(0) {}

    // copy assignment operator, using the copy-and-swap idiom
    stack<T> &operator=(stack<T> other)
    {
      using std::swap;
      swap(mSize, other.mSize);
      swap(mCap, other.mCap);
      swap(mData, other.mData);
      swap(aux, other.aux);
      return *this;
    }

    ~stack() { delete[] mData; }

    //------------- capacity function -------------------
    bool empty() const { return mSize == 0; }

    size_t size() const { return mSize; }

    // for student.h
    // @@DECLARATIONS@@
  };

} // namespace CP

#endif
